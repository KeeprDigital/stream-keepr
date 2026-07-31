import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsIngestionOperation,
	GraphicsOperationalQueueId,
} from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const pixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);
const replacementPng = Uint8Array.of(
	...pixelPng.slice(0, -12),
	...emptyTextChunk,
	...pixelPng.slice(-12),
);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function canonicalIdentity(digest: string) {
	return graphicsObjectIdentity(`sha256/${digest}`);
}

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: digestOf(bytes),
		width: 1,
		height: 1,
	};
}

let harness: SqliteD1Harness;

function createQueuesLibrary(
	dependencies: Partial<Parameters<typeof createGraphicsAssetLibrary>[0]> = {},
) {
	let currentTime = new Date('2026-07-28T00:00:00.000Z');
	let nextIdentity = 0;
	const staging = createInMemoryStagingGraphicsObjectStore();
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const library = createGraphicsAssetLibrary({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		staging,
		canonical,
		now: () => currentTime,
		generateIdentity: () => `queues-${++nextIdentity}`,
		...dependencies,
	});
	return {
		library,
		staging,
		canonical,
		now: () => currentTime,
		advance(milliseconds: number) {
			currentTime = new Date(currentTime.getTime() + milliseconds);
		},
	};
}

type QueuesLibrary = ReturnType<typeof createQueuesLibrary>;

async function ingestAsset(
	context: QueuesLibrary,
	options: { idempotencyKey: string; name: string; bytes?: Uint8Array },
): Promise<GraphicsIngestionOperation> {
	const bytes = options.bytes ?? pixelPng;
	const operation = await context.library.initiateGraphicsIngestion({
		idempotencyKey: options.idempotencyKey,
		initiatedBy: 'queues-author',
		name: options.name,
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: decodeEvidence(bytes),
		declaredByteLength: bytes.byteLength,
		duplicateContentPolicy: 'create-separate',
	});
	context.advance(1000);
	return await context.library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: createBoundedByteStream(bytes, {
			byteLength: bytes.byteLength,
			maximumByteLength: bytes.byteLength,
		}),
	});
}

async function replaceAsset(
	context: QueuesLibrary,
	input: { assetId: GraphicAssetId; idempotencyKey: string; bytes: Uint8Array },
): Promise<GraphicsIngestionOperation> {
	const operation = await context.library.initiateGraphicAssetReplacement({
		assetId: input.assetId,
		idempotencyKey: input.idempotencyKey,
		initiatedBy: 'queues-author',
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: decodeEvidence(input.bytes),
		declaredByteLength: input.bytes.byteLength,
	});
	context.advance(1000);
	return await context.library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: createBoundedByteStream(input.bytes, {
			byteLength: input.bytes.byteLength,
			maximumByteLength: input.bytes.byteLength,
		}),
	});
}

/** Arranged exactly as the Screen reference writer does, then observed publicly. */
async function addReference(input: {
	referenceId: string;
	assetId: GraphicAssetId;
	revisionId: GraphicAssetRevisionId;
	ownerSlot?: string;
}) {
	await harness.client.execute({
		sql: `
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			) VALUES (?, ?, ?, 'screen', '1', ?, NULL, 0, 0)
		`,
		args: [
			input.referenceId,
			input.assetId,
			input.revisionId,
			input.ownerSlot ?? 'layout.frame.backgroundImage',
		],
	});
}

async function removeReference(referenceId: string) {
	await harness.client.execute({
		sql: 'DELETE FROM graphic_asset_references WHERE id = ?',
		args: [referenceId],
	});
}

function queueOf(
	overview: { queues: readonly { id: GraphicsOperationalQueueId }[] },
	id: GraphicsOperationalQueueId,
) {
	const queue = overview.queues.find(candidate => candidate.id === id);
	if (!queue)
		throw new Error(`No ${id} queue in the reading`);
	return queue;
}

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => await harness.close());

describe('the Graphics Asset Library operational queues', () => {
	it('orders the queues by operational risk rather than by provider object', async () => {
		const context = createQueuesLibrary();
		const overview = await context.library.getOperationalQueues();

		// Every queue is named for what is wrong, and a reading always states all
		// of them so an empty queue is visibly empty rather than missing.
		expect(overview.queues.map(queue => queue.id)).toEqual([
			'critical-integrity-incident',
			'unavailable-content',
			'missing-derivative',
			'retryable-ingestion',
			'expired-ingestion-input',
			'trashed-asset',
			'superseded-revision',
			'quarantined-object',
			'retired-asset',
		]);

		// The authority contract is restated, so a queue reader never has to infer
		// which side decides what is expected and which decides what exists.
		expect(overview.authority).toEqual({
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		});
	});

	it('keeps Retired, Trashed, and superseded work in separate queues', async () => {
		const context = createQueuesLibrary();

		const retired = await ingestAsset(context, {
			idempotencyKey: 'retired-asset',
			name: 'Retired backdrop',
		});
		await context.library.retireGraphicAsset({
			assetId: retired.result!.assetId,
		});

		const trashed = await ingestAsset(context, {
			idempotencyKey: 'trashed-asset',
			name: 'Trashed backdrop',
		});
		await context.library.trashGraphicAsset({
			assetId: trashed.result!.assetId,
		});
		const trashedAt = context.now().getTime();

		// A superseded revision only becomes prunable once its last reference goes.
		const superseded = await ingestAsset(context, {
			idempotencyKey: 'superseded-asset',
			name: 'Replaced backdrop',
		});
		await addReference({
			referenceId: 'reference-superseded',
			assetId: superseded.result!.assetId,
			revisionId: superseded.result!.revisionId,
		});
		await replaceAsset(context, {
			assetId: superseded.result!.assetId,
			idempotencyKey: 'superseded-replacement',
			bytes: replacementPng,
		});
		await removeReference('reference-superseded');
		await context.library.runGraphicsRetention();
		const pruningScheduledAt = context.now().getTime();

		const overview = await context.library.getOperationalQueues();

		expect(queueOf(overview, 'retired-asset')).toMatchObject({
			totalCount: 1,
			severity: 'info',
			items: [{
				subject: { kind: 'graphic-asset', id: retired.result!.assetId },
				title: 'Retired backdrop',
				actions: ['restore-graphic-asset'],
			}],
		});
		// Retirement is reversible and never expires, so it carries no deadline.
		expect(queueOf(overview, 'retired-asset').items[0]!.deadline).toBeUndefined();

		expect(queueOf(overview, 'trashed-asset')).toMatchObject({
			totalCount: 1,
			severity: 'warning',
			items: [{
				subject: { kind: 'graphic-asset', id: trashed.result!.assetId },
				title: 'Trashed backdrop',
				referenceCount: 0,
				actions: ['restore-graphic-asset', 'purge-now'],
			}],
		});
		expect(queueOf(overview, 'trashed-asset').items[0]!.deadline)
			.toBe(new Date(trashedAt + 30 * DAY).toISOString());

		const supersededQueue = queueOf(overview, 'superseded-revision');
		expect(supersededQueue.totalCount).toBe(1);
		expect(supersededQueue.items[0]).toMatchObject({
			subject: {
				kind: 'graphic-asset-revision',
				id: superseded.result!.revisionId,
			},
			// Pruning is the retention sweep's own decision, so nothing is offered.
			actions: [],
		});
		expect(supersededQueue.items[0]!.deadline)
			.toBe(new Date(pruningScheduledAt + 90 * DAY).toISOString());
	});

	it('separates a retryable ingestion from one whose staged input expired', async () => {
		const context = createQueuesLibrary();
		context.canonical.injectTransientFailure('create', 2);
		const interrupted = await context.library.initiateGraphicsIngestion({
			idempotencyKey: 'retryable-operation',
			initiatedBy: 'queues-author',
			name: 'Interrupted publication',
			sourceFileName: 'logo.png',
			declaredMime: 'image/png',
			browserDecodeEvidence: decodeEvidence(pixelPng),
			declaredByteLength: pixelPng.byteLength,
		});
		await context.library.uploadGraphicAsset({
			operationId: interrupted.id,
			initiatedBy: interrupted.initiatedBy,
			declaredMime: 'image/png',
			bytes: createBoundedByteStream(pixelPng, {
				byteLength: pixelPng.byteLength,
				maximumByteLength: pixelPng.byteLength,
			}),
		});

		const abandoned = await context.library.initiateGraphicsIngestion({
			idempotencyKey: 'expiring-operation',
			initiatedBy: 'queues-author',
			name: 'Abandoned transfer',
			sourceFileName: 'logo.png',
			declaredMime: 'image/png',
			declaredByteLength: pixelPng.byteLength,
		});

		const retryable = queueOf(
			await context.library.getOperationalQueues(),
			'retryable-ingestion',
		);
		expect(retryable.totalCount).toBe(1);
		expect(retryable.items[0]).toMatchObject({
			subject: { kind: 'graphics-ingestion-operation', id: interrupted.id },
			title: 'Interrupted publication',
			// Resumable from the input the library is still holding.
			actions: ['retry-ingestion'],
		});

		// Past its guarantee the same operation cannot be resumed at all, so it
		// moves to a different queue and stops offering a retry. Completed staged
		// input is held for seven days, so that is the window that has to pass.
		context.advance(8 * DAY);
		const expired = await context.library.getOperationalQueues();

		expect(queueOf(expired, 'retryable-ingestion').totalCount).toBe(0);
		expect(queueOf(expired, 'expired-ingestion-input').totalCount).toBe(2);
		for (const item of queueOf(expired, 'expired-ingestion-input').items) {
			// Expired input needs a new operation, so no retry is ever offered.
			expect(item.actions).toEqual([]);
		}
		expect(queueOf(expired, 'expired-ingestion-input').items.map(item => item.subject.id))
			.toEqual(expect.arrayContaining([interrupted.id, abandoned.id]));

		// Once the sweep has recorded the expiry the operations are finished
		// business rather than outstanding work, so they leave the queues.
		await context.library.runGraphicsRetention();
		const swept = await context.library.getOperationalQueues();
		expect(queueOf(swept, 'expired-ingestion-input').totalCount).toBe(0);
		expect(queueOf(swept, 'retryable-ingestion').totalCount).toBe(0);
	});

	it('offers exact-byte repair for unavailable content and nothing else for a quarantined object', async () => {
		const context = createQueuesLibrary();
		const published = await ingestAsset(context, {
			idempotencyKey: 'unavailable-content',
			name: 'Lost backdrop',
		});
		await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
		await context.library.runGraphicsReconciliation();

		const overview = await context.library.getOperationalQueues();
		const unavailable = queueOf(overview, 'unavailable-content');

		expect(unavailable.severity).toBe('warning');
		expect(unavailable.totalCount).toBe(1);
		expect(unavailable.items[0]!.subject.kind).toBe('graphics-discrepancy');
		// Repair takes only exact verified bytes; nothing here creates a revision.
		expect(unavailable.items[0]!.actions).toContain('repair-with-exact-bytes');
		expect(unavailable.items[0]!.actions).not.toContain('regenerate-derivative');
		expect(unavailable.items[0]!.title).toContain('Lost backdrop');
		expect(published.result!.assetId).toBeTruthy();

		// Quarantined bytes are rechecked and deleted, never adopted.
		const quarantined = queueOf(overview, 'quarantined-object');
		expect(quarantined.severity).toBe('info');
		for (const item of quarantined.items)
			expect(item.actions.join(' ')).not.toContain('adopt');
	});

	it('states one complete count per queue and lists work deadline-first', async () => {
		const context = createQueuesLibrary();
		const first = await ingestAsset(context, {
			idempotencyKey: 'trash-first',
			name: 'First into Trash',
		});
		await context.library.trashGraphicAsset({ assetId: first.result!.assetId });
		context.advance(2 * DAY);
		const second = await ingestAsset(context, {
			idempotencyKey: 'trash-second',
			name: 'Second into Trash',
		});
		await context.library.trashGraphicAsset({ assetId: second.result!.assetId });

		const trash = queueOf(await context.library.getOperationalQueues(), 'trashed-asset');

		expect(trash.totalCount).toBe(2);
		// The soonest deadline is the one an administrator has least time to act on.
		expect(trash.items.map(item => item.title))
			.toEqual(['First into Trash', 'Second into Trash']);
		expect(trash.nextDeadline).toBe(trash.items[0]!.deadline);
	});
});

describe('the operational queue inspector', () => {
	it('shows a Trashed asset with its deadline, usage, and audit history', async () => {
		const context = createQueuesLibrary();
		const asset = await ingestAsset(context, {
			idempotencyKey: 'inspected-trash',
			name: 'Inspected backdrop',
		});
		await context.library.trashGraphicAsset({ assetId: asset.result!.assetId });

		// A blocked purge is a durable decision the inspector must be able to show.
		await addReference({
			referenceId: 'reference-inspected',
			assetId: asset.result!.assetId,
			revisionId: asset.result!.revisionId,
		});
		await context.library.purgeTrashedGraphicAsset({
			assetId: asset.result!.assetId,
			actor: 'queues-administrator',
			confirmation: 'purge-now',
		});

		const inspection = await context.library.inspectOperationalQueueItem({
			queue: 'trashed-asset',
			subjectId: asset.result!.assetId,
		});

		expect(inspection).toMatchObject({
			queue: 'trashed-asset',
			severity: 'warning',
			subject: { kind: 'graphic-asset', id: asset.result!.assetId },
			title: 'Inspected backdrop',
			referenceCount: 1,
		});
		expect(inspection.deadline)
			.toBe(new Date(context.now().getTime() + 30 * DAY).toISOString());

		// Trash preserves the state restoration returns the asset to.
		expect(inspection.detail).toMatchObject({
			kind: 'graphic-asset',
			lifecycle: { state: 'trashed', priorState: 'active' },
		});
		expect(inspection.detail).toMatchObject({
			usage: [{ owner: { kind: 'screen', slot: 'layout.frame.backgroundImage' } }],
		});

		// The ledger is filtered to this subject rather than to the newest rows
		// the installation happens to hold.
		expect(inspection.evidence).toHaveLength(1);
		expect(inspection.evidence[0]).toMatchObject({
			category: 'graphic-asset-purge-blocked',
			subject: { kind: 'graphic-asset', id: asset.result!.assetId },
			outcome: 'graphic-asset-retained',
			reason: 'reference-proof-found-usage',
			detail: { referenceCount: 1 },
		});
	});

	it('distinguishes what the catalogue expects from what the byte store reported', async () => {
		const context = createQueuesLibrary();
		await ingestAsset(context, {
			idempotencyKey: 'inspected-unavailable',
			name: 'Unreachable backdrop',
		});
		await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
		await context.library.runGraphicsReconciliation();

		const queue = queueOf(
			await context.library.getOperationalQueues(),
			'unavailable-content',
		);
		const inspection = await context.library.inspectOperationalQueueItem({
			queue: 'unavailable-content',
			subjectId: queue.items[0]!.subject.id,
		});

		expect(inspection.detail).toMatchObject({
			kind: 'graphics-discrepancy',
			discrepancy: {
				kind: 'unavailable-content',
				state: 'open',
				reasonCode: 'canonical-object-missing',
				// D1 says how many bytes it expects to reach.
				expected: { byteLength: pixelPng.byteLength },
				// R2 says only what it can currently see.
				observed: { present: false },
			},
		});

		// Every pinned use stays intact and is named, because repair changes none
		// of them.
		expect(inspection.detail).toMatchObject({
			discrepancy: { affectedUsage: [{ assetName: 'Unreachable backdrop' }] },
		});
		expect(inspection.actions).toContain('repair-with-exact-bytes');
		expect(inspection.evidence.map(entry => entry.category))
			.toContain('content-unavailable-detected');
	});

	it('refuses to inspect a subject that is not in the queue it was asked for', async () => {
		const context = createQueuesLibrary();
		const asset = await ingestAsset(context, {
			idempotencyKey: 'wrong-queue',
			name: 'Active backdrop',
		});

		await expect(context.library.inspectOperationalQueueItem({
			queue: 'trashed-asset',
			subjectId: asset.result!.assetId,
		})).rejects.toMatchObject({ code: 'ingestion-operation-not-found' });
	});
});

describe('the Evidence ledger read by subject', () => {
	it('returns only the entries recorded against the subject asked for', async () => {
		const context = createQueuesLibrary();
		const blocked = await ingestAsset(context, {
			idempotencyKey: 'evidence-blocked',
			name: 'Blocked backdrop',
		});
		const other = await ingestAsset(context, {
			idempotencyKey: 'evidence-other',
			name: 'Other backdrop',
			bytes: replacementPng,
		});
		for (const asset of [blocked, other]) {
			await context.library.trashGraphicAsset({ assetId: asset.result!.assetId });
			await addReference({
				referenceId: `reference-${asset.result!.assetId}`,
				assetId: asset.result!.assetId,
				revisionId: asset.result!.revisionId,
				ownerSlot: `layout.frame.${asset.result!.assetId}`,
			});
			await context.library.purgeTrashedGraphicAsset({
				assetId: asset.result!.assetId,
				actor: 'queues-administrator',
				confirmation: 'purge-now',
			});
		}

		const entries = await context.library.listGraphicsAssetEvidence({
			subject: { kind: 'graphic-asset', id: blocked.result!.assetId },
		});

		expect(entries).toHaveLength(1);
		expect(entries[0]!.subject.id).toBe(blocked.result!.assetId);

		// The unfiltered read still sees both, so the filter is narrowing rather
		// than the ledger only ever having held one entry.
		await expect(context.library.listGraphicsAssetEvidence())
			.resolves
			.toHaveLength(2);
	});
});
