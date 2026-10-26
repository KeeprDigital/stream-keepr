import type {
	GraphicAssetId,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsOperationalQueueId } from '~~/shared/utils/graphicsOperationalQueues';
import type { TestGraphicsLibrary, TestGraphicsLibraryOptions } from '~~/test/helpers/graphicsLibrary';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createD1GraphicsAssetReconciliationCatalogue } from '~~/server/modules/graphics-asset-library/catalogue-reconciliation';
import { createD1GraphicsAssetRetentionCatalogue } from '~~/server/modules/graphics-asset-library/catalogue-retention';

import { evidenceOf } from '~~/test/helpers/graphicsEvidence';
import {
	digestOf,
	pngWithTextChunks as paddedPng,
	pixelPng,
	replacementPng,
} from '~~/test/helpers/graphicsFixtures';
import {
	addScreenReference,
	boundedBytes,
	canonicalIdentity,
	canonicalMetadata,
	createTestGraphicsLibrary,
	DAY,
	ingestImage,
	initiateImage,
	removeScreenReference,
	replaceImage,
	uploadImage,
} from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

function createQueuesLibrary(dependencies: Partial<TestGraphicsLibraryOptions> = {}) {
	return createTestGraphicsLibrary({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		identityPrefix: 'queues',
		...dependencies,
	});
}

const author = { initiatedBy: 'queues-author' };
function ingestAsset(context: TestGraphicsLibrary, options: { idempotencyKey: string; name: string; bytes?: Uint8Array }) {
	return ingestImage(context, {
		...author,
		...options,
	});
}
function replaceAsset(context: TestGraphicsLibrary, options: { assetId: GraphicAssetId; idempotencyKey: string; bytes: Uint8Array }) {
	return replaceImage(context, {
		...author,
		...options,
	});
}
const addReference = (input: Parameters<typeof addScreenReference>[1]) => addScreenReference(harness, input);
const removeReference = (referenceId: string) => removeScreenReference(harness, referenceId);
function initiateQueuedImage(context: TestGraphicsLibrary, options: Parameters<typeof initiateImage>[1]) {
	return initiateImage(context, {
		...author,
		...options,
	});
}

function queueOf<Queue extends { id: GraphicsOperationalQueueId }>(
	overview: { queues: readonly Queue[] },
	id: GraphicsOperationalQueueId,
): Queue {
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
			'unreleased-staged-input',
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
			items: [
				{
					subject: { kind: 'graphic-asset', id: retired.result!.assetId },
					title: 'Retired backdrop',
					actions: ['restore-graphic-asset'],
				},
			],
		});
		// Retirement is reversible and never expires, so it carries no deadline.
		expect(queueOf(overview, 'retired-asset').items[0]!.deadline).toBeUndefined();

		expect(queueOf(overview, 'trashed-asset')).toMatchObject({
			totalCount: 1,
			severity: 'warning',
			items: [
				{
					subject: { kind: 'graphic-asset', id: trashed.result!.assetId },
					title: 'Trashed backdrop',
					referenceCount: 0,
					actions: ['restore-graphic-asset', 'purge-now'],
				},
			],
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
		const interrupted = await initiateQueuedImage(context, { idempotencyKey: 'retryable-operation', name: 'Interrupted publication' });
		await uploadImage(context, interrupted);

		const abandoned = await initiateQueuedImage(context, { idempotencyKey: 'expiring-operation', name: 'Abandoned transfer', decoded: false });

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

describe('one queue never crowding out another', () => {
	it('offers a retryable ingestion its retry behind a backlog of expired input', async () => {
		const context = createQueuesLibrary();

		// One operation the library is still holding verified input for.
		context.canonical.injectTransientFailure('create', 2);
		const interrupted = await initiateQueuedImage(context, { idempotencyKey: 'starved-retryable', name: 'Interrupted publication' });
		await uploadImage(context, interrupted);

		// A backlog of abandoned transfers larger than any one queue's sample,
		// each a minute apart so their expiry deadlines are genuinely distinct.
		const beyondSample: string[] = [];
		for (let index = 0; index < 60; index++) {
			const abandoned = await context.library.initiateGraphicsIngestion({
				idempotencyKey: `abandoned-${index}`,
				initiatedBy: 'queues-author',
				name: `Abandoned ${index}`,
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});
			beyondSample.push(abandoned.id);
			context.advance(60 * 1000);
		}
		context.advance(DAY + 1);

		const overview = await context.library.getOperationalQueues();
		const expired = queueOf(overview, 'expired-ingestion-input');
		const retryable = queueOf(overview, 'retryable-ingestion');

		expect(expired.totalCount).toBe(60);
		// The retryable operation is listed, not merely counted: a queue whose
		// only action is unreachable is the same as no queue at all.
		expect(retryable.totalCount).toBe(1);
		expect(retryable.items).toHaveLength(1);
		expect(retryable.items[0]).toMatchObject({
			subject: { kind: 'graphics-ingestion-operation', id: interrupted.id },
			actions: ['retry-ingestion'],
		});

		// The inspector resolves its subject by identity, so an operation past the
		// end of the triage sample still inspects rather than reading as gone.
		const listed = new Set(
			expired.items.map(item => item.subject.id),
		);
		const unlisted = beyondSample.find(id => !listed.has(id));
		expect(unlisted).toBeDefined();
		await expect(context.library.inspectOperationalQueueItem({
			queue: 'expired-ingestion-input',
			subjectId: unlisted!,
		})).resolves.toMatchObject({
			queue: 'expired-ingestion-input',
			subject: { kind: 'graphics-ingestion-operation', id: unlisted },
			actions: [],
		});
	});

	it('queues a stranded release with its one action, and clears it exactly when the state clears', async () => {
		const context = createQueuesLibrary();
		// A publication that fails retryably leaves staged bytes; the expiry
		// sweep claims it while the staging store cannot answer its deletes, so
		// the objects strand with the accounting still on the books (#358).
		context.canonical.injectTransientFailure('create', 2);
		const stranded = await ingestAsset(context, {
			idempotencyKey: 'stranded-release',
			name: 'Stranded release',
		});
		context.advance(8 * DAY);
		context.staging.injectTransientFailure('delete', 2);
		await context.library.runGraphicsRetention();

		const overview = await context.library.getOperationalQueues();
		const queue = queueOf(overview, 'unreleased-staged-input');
		expect(queue.severity).toBe('warning');
		expect(queue.totalCount).toBe(1);
		expect(queue.items).toHaveLength(1);
		expect(queue.items[0]).toMatchObject({
			subject: { kind: 'graphics-ingestion-operation', id: stranded.id },
			actions: ['retry-release'],
		});

		const inspection = await context.library.inspectOperationalQueueItem({
			queue: 'unreleased-staged-input',
			subjectId: stranded.id,
		});
		expect(inspection.detail).toMatchObject({
			kind: 'unreleased-staged-input',
			strand: { operationId: stranded.id, stagingBytes: pixelPng.byteLength },
		});
		expect(inspection.actions).toEqual(['retry-release']);
		expect(inspection.evidence.map(entry => entry.category))
			.toContain('staged-input-expired');

		// The retry action releases it; the queue entry clears with the state.
		await expect(context.library.releaseStrandedStagedInput({
			operationId: stranded.id,
			actor: 'graphics-admin',
		})).resolves.toMatchObject({ outcome: 'completed' });
		const after = await context.library.getOperationalQueues();
		expect(queueOf(after, 'unreleased-staged-input').totalCount).toBe(0);
		await expect(context.library.inspectOperationalQueueItem({
			queue: 'unreleased-staged-input',
			subjectId: stranded.id,
		})).rejects.toThrow('no longer in that queue');
	});

	it('lists the quarantined objects closest to deletion, not the newest', async () => {
		const context = createQueuesLibrary();
		const firstDigest = digestOf(paddedPng(1));
		await context.canonical.createImmutable({
			identity: canonicalIdentity(firstDigest),
			bytes: boundedBytes(paddedPng(1)),
			metadata: canonicalMetadata(firstDigest),
		});
		await context.library.runGraphicsReconciliation();

		// Objects quarantined later are deleted later, so ordering by when each was
		// noticed puts the most urgent last.
		for (const index of [2, 3]) {
			context.advance(2 * DAY);
			const digest = digestOf(paddedPng(index));
			await context.canonical.createImmutable({
				identity: canonicalIdentity(digest),
				bytes: boundedBytes(paddedPng(index)),
				metadata: canonicalMetadata(digest),
			});
			await context.library.runGraphicsReconciliation();
		}

		const quarantined = queueOf(
			await context.library.getOperationalQueues(),
			'quarantined-object',
		);

		expect(quarantined.totalCount).toBe(3);
		const deadlines = quarantined.items.map(item => item.deadline);
		expect(deadlines).toEqual([...deadlines].sort());
		// The stated next deadline is the one actually nearest, not the nearest
		// among whichever rows happened to be sampled.
		expect(quarantined.nextDeadline).toBe(deadlines[0]);

		// Which rows a bounded sample leaves out is what actually matters, and the
		// queue's own budget is far larger than any fixture worth seeding. Asked
		// for two of the three, the read must offer the two closest to deletion —
		// under newest-first ordering it would offer the two furthest from it.
		const sampled = await createD1GraphicsAssetReconciliationCatalogue(harness.database)
			.listDiscrepancies({
				limit: 2,
				states: ['open'],
				kinds: ['unexpected-object'],
				orderBy: 'quarantine-deadline',
			});
		expect(sampled.map(discrepancy => discrepancy.id)).toEqual(
			quarantined.items.slice(0, 2).map(item => item.subject.id),
		);
	});

	it('lists the superseded revisions closest to pruning and skips frozen ones', async () => {
		const context = createQueuesLibrary();
		const revisions: string[] = [];
		for (let index = 1; index <= 3; index++) {
			const asset = await ingestAsset(context, {
				idempotencyKey: `pruning-${index}`,
				name: `Pruning ${index}`,
				bytes: paddedPng(index + 10),
			});
			await addReference({
				referenceId: `reference-pruning-${index}`,
				assetId: asset.result!.assetId,
				revisionId: asset.result!.revisionId,
				ownerSlot: `layout.frame.pruning-${index}`,
			});
			await replaceAsset(context, {
				assetId: asset.result!.assetId,
				idempotencyKey: `pruning-replacement-${index}`,
				bytes: paddedPng(index + 20),
			});
			await removeReference(`reference-pruning-${index}`);
			// Each becomes prunable a day apart, so pruning order and identity
			// order are deliberately different.
			await context.library.runGraphicsRetention();
			revisions.push(asset.result!.revisionId);
			context.advance(DAY);
		}

		const superseded = queueOf(
			await context.library.getOperationalQueues(),
			'superseded-revision',
		);

		expect(superseded.totalCount).toBe(3);
		const deadlines = superseded.items.map(item => item.deadline);
		expect(deadlines).toEqual([...deadlines].sort());
		expect(superseded.items.map(item => item.subject.id)).toEqual(revisions);
		expect(superseded.nextDeadline).toBe(deadlines[0]);

		// Asked for two of the three, the read must offer the two pruned soonest
		// rather than whichever asset identities happen to sort first.
		const sampled = await createD1GraphicsAssetRetentionCatalogue(harness.database)
			.listRevisionRetention({ limit: 2, prunableOnly: true });
		expect(sampled.map(deadline => deadline.revisionId))
			.toEqual(revisions.slice(0, 2));
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
			usage: [
				{
					owner: { kind: 'screen', slot: 'layout.frame.backgroundImage' },
				},
			],
		});

		// The ledger is filtered to this subject rather than to the newest rows
		// the installation happens to hold, and it is chronological, so the
		// refused purge is above the Trash transition that preceded it.
		expect(inspection.evidence).toHaveLength(2);
		expect(inspection.evidence[0]).toMatchObject({
			category: 'graphic-asset-purge-blocked',
			subject: { kind: 'graphic-asset', id: asset.result!.assetId },
			outcome: 'graphic-asset-retained',
			reason: 'reference-proof-found-usage',
			detail: { referenceCount: 1 },
		});
		// Trash is where the recovery deadline was established, so the deadline
		// the inspector shows above has Evidence standing behind it.
		expect(inspection.evidence[1]).toMatchObject({
			category: 'graphic-asset-trashed',
			detail: {
				transition: { from: 'active', to: 'trashed' },
				deadline: inspection.deadline,
			},
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
			discrepancy: {
				affectedUsage: [
					{ assetName: 'Unreachable backdrop' },
				],
			},
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
		})).rejects.toMatchObject({ code: 'graphics-subject-not-found' });
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

		const entries = await evidenceOf(context.library, {
			subject: { kind: 'graphic-asset', id: blocked.result!.assetId },
		});

		expect(entries).not.toHaveLength(0);
		for (const entry of entries)
			expect(entry.subject.id).toBe(blocked.result!.assetId);

		// The unfiltered read still sees the other asset's entries too, so the
		// filter is narrowing rather than the ledger only ever having held one
		// subject's worth.
		const everything = await evidenceOf(context.library);
		expect(everything.length).toBeGreaterThan(entries.length);
		expect(everything.some(entry => entry.subject.id === other.result!.assetId))
			.toBe(true);
	});
});
