import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
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

const GIB = 1024 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const pixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

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

function boundedBytes(bytes: Uint8Array) {
	return createBoundedByteStream(bytes, {
		byteLength: bytes.byteLength,
		maximumByteLength: bytes.byteLength,
	});
}

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

function createCockpitLibrary(
	dependencies: Partial<Parameters<typeof createGraphicsAssetLibrary>[0]> = {},
) {
	let currentTime = new Date('2026-07-30T00:00:00.000Z');
	let nextIdentity = 0;
	const staging = createInMemoryStagingGraphicsObjectStore();
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const library = createGraphicsAssetLibrary({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		staging,
		canonical,
		now: () => currentTime,
		generateIdentity: () => `cockpit-${++nextIdentity}`,
		...dependencies,
	});
	return {
		library,
		staging,
		canonical,
		advance(milliseconds: number) {
			currentTime = new Date(currentTime.getTime() + milliseconds);
		},
	};
}

type CockpitLibrary = ReturnType<typeof createCockpitLibrary>;

async function ingestImage(
	context: CockpitLibrary,
	options: { idempotencyKey: string; name: string },
): Promise<GraphicsIngestionOperation> {
	const operation = await context.library.initiateGraphicsIngestion({
		idempotencyKey: options.idempotencyKey,
		initiatedBy: 'cockpit-author',
		name: options.name,
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: decodeEvidence(pixelPng),
		declaredByteLength: pixelPng.byteLength,
		duplicateContentPolicy: 'create-separate',
	});
	context.advance(1000);
	return await context.library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: boundedBytes(pixelPng),
	});
}

function publishedAssetId(operation: GraphicsIngestionOperation) {
	if (!operation.result)
		throw new Error('The ingestion operation did not publish a Graphic Asset');
	return operation.result.assetId;
}

describe('the Operations Cockpit against a real catalogue', () => {
	it('reports a settled library as safe, with the exact canonical quota boundaries', async () => {
		const { library } = createCockpitLibrary();

		const cockpit = await library.getOperationsCockpit();

		expect(cockpit.outcome).toBe('complete');
		if (cockpit.outcome !== 'complete')
			return;

		expect(cockpit.condition).toEqual({
			status: 'healthy',
			catalogue: { status: 'healthy' },
			canonicalByteStore: { status: 'healthy' },
			stagingByteStore: { status: 'healthy' },
		});
		expect(cockpit.alerts).toEqual({
			countsBySeverity: { critical: 0, warning: 0, info: 0 },
			open: [],
		});

		expect(cockpit.capacity.canonical.limitBytes).toBe(100 * GIB);
		expect(cockpit.capacity.canonical.boundaries).toEqual({
			warningFraction: 0.8,
			criticalFraction: 0.95,
			fullFraction: 1,
			warningBytes: 80 * GIB,
			criticalBytes: 95 * GIB,
			fullBytes: 100 * GIB,
		});
		expect(cockpit.capacity.canonical.usedFraction).toBe(0);
		// The Graphics Staging Allowance is its own budget and carries no
		// canonical boundary of any kind.
		expect(cockpit.capacity.staging.limitBytes).toBe(10 * GIB);
		expect(cockpit.capacity.staging).not.toHaveProperty('boundaries');
		expect(cockpit.capacity.staging).not.toHaveProperty('pressure');

		expect(cockpit.ingestion.counts).toEqual({
			'active': 0,
			'awaiting-confirmation': 0,
			'retryable': 0,
			'input-expired': 0,
		});
		expect(cockpit.ingestion.operations).toEqual([]);

		expect(cockpit.reconciliation.openCounts).toEqual({
			'unavailable-content': 0,
			'missing-derivative': 0,
			'unexpected-object': 0,
			'critical-integrity-incident': 0,
		});
		expect(cockpit.reconciliation.countsBySeverity)
			.toEqual({ critical: 0, warning: 0, info: 0 });
		expect(cockpit.reconciliation.isolatedIncidentCount).toBe(0);
		expect(cockpit.reconciliation.authority).toEqual({
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		});

		// Retirement is the one reversible state with no deadline at all, and the
		// reading says so rather than leaving its absence to be inferred.
		expect(cockpit.lifecycle.retired).toEqual({
			count: 0,
			reversibleWithoutDeadline: true,
		});
		expect(cockpit.lifecycle.trashed).toEqual({
			count: 0,
			guaranteeMilliseconds: 30 * 24 * 60 * 60 * 1000,
		});
		expect(cockpit.lifecycle.supersededRevisions).toEqual({
			count: 0,
			guaranteeMilliseconds: 90 * 24 * 60 * 60 * 1000,
		});
		expect(cockpit.lifecycle.guaranteesShortenedUnderPressure).toBe(false);

		expect(cockpit.recentOutcomes.entries).toEqual([]);
		expect(cockpit.recentOutcomes.countsByGroup).toEqual({
			'unavailable-content': 0,
			'missing-derivative': 0,
			'quarantined-object': 0,
			'integrity-incident': 0,
			'resolved-repair': 0,
			'rejected-repair': 0,
		});
	});

	it('separates unfinished ingestion by what it needs, with its exact stage facts', async () => {
		const context = createCockpitLibrary({
			remoteSource: {
				async open() {
					return {
						outcome: 'open' as const,
						byteLength: pixelPng.byteLength,
						body: new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(pixelPng);
								controller.close();
							},
						}),
					};
				},
			},
		});

		// One transfer that never started, and will outlive its 24-hour guarantee.
		const abandoned = await context.library.initiateGraphicsIngestion({
			idempotencyKey: 'abandoned',
			initiatedBy: 'cockpit-author',
			name: 'Abandoned upload',
			sourceFileName: 'logo.png',
			declaredMime: 'image/png',
			browserDecodeEvidence: decodeEvidence(pixelPng),
			declaredByteLength: pixelPng.byteLength,
		});

		context.advance(2 * DAY);

		// One complete remote copy paused for its author to confirm.
		const paused = await context.library.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'awaiting',
			initiatedBy: 'other-author',
			name: 'Remote copy awaiting confirmation',
			sourceFileName: 'logo.png',
		});
		const copied = await context.library.copyRemoteGraphicAssetSource({
			operationId: paused.id,
			initiatedBy: paused.initiatedBy,
			sourceUrl: 'https://cdn.example.test/logo.png',
		});
		expect(copied.stage).toBe('awaiting-confirmation');

		// One transfer still in flight.
		const active = await context.library.initiateGraphicsIngestion({
			idempotencyKey: 'active',
			initiatedBy: 'cockpit-author',
			name: 'Active upload',
			sourceFileName: 'logo.png',
			declaredMime: 'image/png',
			browserDecodeEvidence: decodeEvidence(pixelPng),
			declaredByteLength: pixelPng.byteLength,
		});

		const cockpit = await context.library.getOperationsCockpit();
		if (cockpit.outcome !== 'complete')
			throw new Error('The cockpit could not read the catalogue');

		expect(cockpit.ingestion.counts).toEqual({
			'input-expired': 1,
			'awaiting-confirmation': 1,
			'active': 1,
			'retryable': 0,
		});

		// Risk order: what has already lost its guarantee comes first, and work
		// that is blocking nobody comes last.
		expect(cockpit.ingestion.operations.map(item => item.operationId))
			.toEqual([abandoned.id, copied.id, active.id]);

		expect(cockpit.ingestion.operations[0]).toEqual({
			operationId: abandoned.id,
			attention: 'input-expired',
			stage: 'created',
			source: 'local-upload',
			initiatedBy: 'cockpit-author',
			name: 'Abandoned upload',
			transferredByteLength: 0,
			declaredByteLength: pixelPng.byteLength,
			transferComplete: false,
			stagingBytes: expect.any(Number),
			inputExpiresAt: new Date(
				new Date(abandoned.updatedAt).getTime() + DAY,
			).toISOString(),
			updatedAt: abandoned.updatedAt,
		});

		// A complete staged input carries the seven-day promise, not the 24-hour one.
		expect(cockpit.ingestion.operations[1]).toMatchObject({
			operationId: copied.id,
			attention: 'awaiting-confirmation',
			stage: 'awaiting-confirmation',
			source: 'remote-copy',
			initiatedBy: 'other-author',
			transferComplete: true,
			inputExpiresAt: new Date(
				new Date(copied.updatedAt).getTime() + 7 * DAY,
			).toISOString(),
		});

		expect(cockpit.alerts.open).toContainEqual({
			code: 'graphics-ingestion-input-expired',
			severity: 'warning',
			openCount: 1,
			persistent: true,
		});
	});

	it('raises a warning Storage Health Alert while any stranded release exists', async () => {
		const context = createCockpitLibrary();
		context.canonical.injectTransientFailure('create', 2);
		const stranded = await ingestImage(context, {
			idempotencyKey: 'stranded-alert',
			name: 'Stranded release',
		});
		context.advance(8 * DAY);
		context.staging.injectTransientFailure('delete', 2);
		await context.library.runGraphicsRetention();

		// Derived from the durable accounting, so it survives navigation and
		// reload until the release lands — the persistent-alert rule verbatim.
		const alerted = await context.library.getOperationsCockpit();
		expect(alerted.outcome).toBe('complete');
		expect(alerted.outcome === 'complete' && alerted.alerts.open).toContainEqual({
			code: 'graphics-staged-input-unreleased',
			severity: 'warning',
			openCount: 1,
			persistent: true,
		});

		await expect(context.library.releaseStrandedStagedInput({
			operationId: stranded.id,
			actor: 'graphics-admin',
		})).resolves.toMatchObject({ outcome: 'completed' });
		const cleared = await context.library.getOperationsCockpit();
		expect(cleared.outcome === 'complete' && cleared.alerts.open)
			.not
			.toContainEqual(expect.objectContaining({
				code: 'graphics-staged-input-unreleased',
			}));
	});

	it('counts each lifecycle group against the distinct deadline it is held to', async () => {
		const context = createCockpitLibrary();
		const retiredAsset = publishedAssetId(
			await ingestImage(context, { idempotencyKey: 'retired', name: 'Retired' }),
		);
		const trashedAsset = publishedAssetId(
			await ingestImage(context, { idempotencyKey: 'trashed', name: 'Trashed' }),
		);

		await context.library.retireGraphicAsset({ assetId: retiredAsset });
		const trashedAt = new Date('2026-07-30T05:00:00.000Z');
		context.advance(trashedAt.getTime() - new Date('2026-07-30T00:00:02.000Z').getTime());
		await context.library.trashGraphicAsset({ assetId: trashedAsset });

		const cockpit = await context.library.getOperationsCockpit();
		if (cockpit.outcome !== 'complete')
			throw new Error('The cockpit could not read the catalogue');

		expect(cockpit.lifecycle.retired).toEqual({
			count: 1,
			reversibleWithoutDeadline: true,
		});
		expect(cockpit.lifecycle.trashed).toEqual({
			count: 1,
			nextDeadline: new Date(trashedAt.getTime() + 30 * DAY).toISOString(),
			guaranteeMilliseconds: 30 * DAY,
		});
		// Storage pressure is never a reason to shorten any of them.
		expect(cockpit.lifecycle.guaranteesShortenedUnderPressure).toBe(false);
	});

	describe('when the canonical byte store has lost content the catalogue expects', () => {
		async function loseCanonicalContent() {
			const context = createCockpitLibrary();
			await ingestImage(context, { idempotencyKey: 'lost', name: 'Lost content' });
			await context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));
			context.advance(HOUR);
			await context.library.runGraphicsReconciliation();
			return context;
		}

		it('degrades the catalogue and the byte store on their own separate evidence', async () => {
			const context = await loseCanonicalContent();

			const cockpit = await context.library.getOperationsCockpit();
			if (cockpit.outcome !== 'complete')
				throw new Error('The cockpit could not read the catalogue');

			// Both sides answer, so neither is unavailable. Each is degraded by
			// what it itself holds: the catalogue by content it has recorded as
			// unresolvable, the byte store by bytes that disagree with what the
			// catalogue expects.
			expect(cockpit.condition.status).toBe('degraded');
			expect(cockpit.condition.catalogue).toEqual({
				status: 'degraded',
				reason: {
					code: 'catalogue-records-unavailable-content',
					retryable: true,
					openCount: 1,
				},
			});
			expect(cockpit.condition.canonicalByteStore).toEqual({
				status: 'degraded',
				reason: {
					code: 'canonical-bytes-disagree-with-catalogue',
					retryable: true,
					openCount: 1,
				},
			});
			expect(cockpit.condition.stagingByteStore).toEqual({ status: 'healthy' });
		});

		it('summarises the backlog by severity and keeps the alert open across readings', async () => {
			const context = await loseCanonicalContent();

			const first = await context.library.getOperationsCockpit();
			if (first.outcome !== 'complete')
				throw new Error('The cockpit could not read the catalogue');

			expect(first.reconciliation.openCounts['unavailable-content']).toBe(1);
			expect(first.reconciliation.countsBySeverity)
				.toEqual({ critical: 0, warning: 1, info: 0 });
			expect(first.alerts.countsBySeverity)
				.toEqual({ critical: 0, warning: 1, info: 0 });
			expect(first.alerts.open).toEqual([
				{
					code: 'unavailable-content-open',
					severity: 'warning',
					openCount: 1,
					persistent: true,
				},
			]);

			// The alert is durable catalogue state, not something the reading
			// remembered, so it survives navigation and reload untouched.
			const second = await context.library.getOperationsCockpit();
			if (second.outcome !== 'complete')
				throw new Error('The cockpit could not read the catalogue');
			expect(second.alerts.open).toEqual(first.alerts.open);
		});

		it('groups the recent outcome and never carries the evidence behind it', async () => {
			const context = await loseCanonicalContent();

			const cockpit = await context.library.getOperationsCockpit();
			if (cockpit.outcome !== 'complete')
				throw new Error('The cockpit could not read the catalogue');

			expect(cockpit.recentOutcomes.countsByGroup['unavailable-content']).toBe(1);
			expect(cockpit.recentOutcomes.entries[0]).toMatchObject({
				group: 'unavailable-content',
				category: 'content-unavailable-detected',
				subject: { kind: 'graphics-discrepancy' },
			});

			// A cockpit reading is domain-shaped throughout: no digest, no object
			// key, no bucket, and no provider error text ever reaches a reader.
			const serialised = JSON.stringify(cockpit);
			expect(serialised).not.toContain(digestOf(pixelPng));
			expect(serialised).not.toContain('sha256');
			expect(serialised).not.toContain('bucket');
			expect(serialised).not.toContain('R2');
		});
	});
});
