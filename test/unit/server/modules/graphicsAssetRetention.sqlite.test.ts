import type {
	GraphicsMultipartUploadIdentity,
	InMemoryGraphicsStagingObjectStore,
} from '~~/server/modules/graphics-asset-library/object-store';
import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsIngestionOperation,
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
import { createGraphicsRemoteSourceFetcher } from '~~/server/modules/graphics-asset-library/remote-source';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { GRAPHICS_EVIDENCE_CATEGORY_GROUPS } from '~~/shared/utils/graphicsAssetEvidence';
import { evidenceOf } from '~~/test/helpers/graphicsEvidence';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { collectStream } from '~~/test/helpers/storedZipArchive';
import { acceptEveryTemplateDocument } from '~~/test/helpers/templatePackagePayload';

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

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: digestOf(bytes),
		width: 1,
		height: 1,
	};
}

let harness: SqliteD1Harness;

function createRetentionLibrary(
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
		templatePayloads: acceptEveryTemplateDocument(),
		now: () => currentTime,
		generateIdentity: () => `retention-${++nextIdentity}`,
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
		advanceTo(instant: string) {
			currentTime = new Date(instant);
		},
	};
}

type RetentionLibrary = ReturnType<typeof createRetentionLibrary>;

async function ingestAsset(
	context: RetentionLibrary,
	options: { idempotencyKey: string; name: string; bytes?: Uint8Array },
): Promise<GraphicsIngestionOperation> {
	const bytes = options.bytes ?? pixelPng;
	const operation = await context.library.initiateGraphicsIngestion({
		idempotencyKey: options.idempotencyKey,
		initiatedBy: 'retention-author',
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
	context: RetentionLibrary,
	input: { assetId: GraphicAssetId; idempotencyKey: string; bytes: Uint8Array },
): Promise<GraphicsIngestionOperation> {
	const operation = await context.library.initiateGraphicAssetReplacement({
		assetId: input.assetId,
		idempotencyKey: input.idempotencyKey,
		initiatedBy: 'retention-author',
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

/**
 * Persisted references are owned by graphics artifacts, not by the library, so
 * tests arrange them exactly as the Screen reference writer does and then
 * observe the consequences through the library interface.
 */
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

/**
 * One Evidence entry written straight to the ledger, for the case the library
 * cannot stage through its own writers: an observation recorded long after the
 * subject it explains was already cleaned up.
 */
async function recordLateEvidence(input: {
	id: string;
	assetId: GraphicAssetId;
	recordedAt: number;
}) {
	await harness.client.execute({
		sql: `
			INSERT INTO graphics_asset_evidence (
				id, recorded_at, category, actor, subject_kind, subject_id,
				outcome, reason, correlation_id, detail, expires_at
			) VALUES (?, ?, 'graphic-asset-purge-blocked', 'installation-administrator',
				'graphic-asset', ?, 'graphic-asset-retained', 'reference-proof-found-usage',
				'late-correlation', '{}', NULL)
		`,
		args: [input.id, input.recordedAt, input.assetId],
	});
}

async function removeReference(referenceId: string) {
	await harness.client.execute({
		sql: 'DELETE FROM graphic_asset_references WHERE id = ?',
		args: [referenceId],
	});
}

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => await harness.close());

describe('scheduled Graphics Asset Library retention', () => {
	describe('staged input expiry', () => {
		it('expires an incomplete transfer after 24 hours without verified progress', async () => {
			const context = createRetentionLibrary();
			const abandoned = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'abandoned-transfer',
				initiatedBy: 'retention-author',
				name: 'Abandoned transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});

			context.advance(DAY - 1);
			await context.library.runGraphicsRetention();
			await expect(context.library.getIngestionOperation({
				operationId: abandoned.id,
				initiatedBy: abandoned.initiatedBy,
			})).resolves.toMatchObject({ stage: 'created' });

			context.advance(1);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.stagedInput).toEqual({
				expiredIncompleteTransfers: 1,
				expiredCompletedInput: 0,
			});
			const expired = await context.library.getIngestionOperation({
				operationId: abandoned.id,
				initiatedBy: abandoned.initiatedBy,
			});
			expect(expired).toMatchObject({
				stage: 'failed',
				failure: { code: 'staged-input-expired', retryable: false },
			});
		});

		it('requires a new operation once staged input has expired', async () => {
			const context = createRetentionLibrary();
			const abandoned = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'expired-needs-new-operation',
				initiatedBy: 'retention-author',
				name: 'Expired transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});
			context.advance(DAY + 1);
			await context.library.runGraphicsRetention();

			await expect(context.library.retryGraphicsIngestion({
				operationId: abandoned.id,
				initiatedBy: abandoned.initiatedBy,
			})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
			await expect(context.library.uploadGraphicAsset({
				operationId: abandoned.id,
				initiatedBy: abandoned.initiatedBy,
				declaredMime: 'image/png',
				bytes: createBoundedByteStream(pixelPng, {
					byteLength: pixelPng.byteLength,
					maximumByteLength: pixelPng.byteLength,
				}),
			})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
		});

		it('retains completed input awaiting retry for seven days', async () => {
			const context = createRetentionLibrary();
			context.canonical.injectTransientFailure('create', 2);
			const operation = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'retryable-completed-input',
				initiatedBy: 'retention-author',
				name: 'Interrupted publication',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				browserDecodeEvidence: decodeEvidence(pixelPng),
				declaredByteLength: pixelPng.byteLength,
			});
			const failed = await context.library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				declaredMime: 'image/png',
				bytes: createBoundedByteStream(pixelPng, {
					byteLength: pixelPng.byteLength,
					maximumByteLength: pixelPng.byteLength,
				}),
			});
			expect(failed).toMatchObject({
				stage: 'failed',
				failure: { retryable: true },
			});

			const lastCheckpoint = new Date(failed.updatedAt).getTime();
			context.advanceTo(new Date(lastCheckpoint + 7 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 0,
			});
			await expect(context.library.getIngestionOperation({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			})).resolves.toMatchObject({ failure: { retryable: true } });

			context.advanceTo(new Date(lastCheckpoint + 7 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 1,
			});
			await expect(context.library.getIngestionOperation({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			})).resolves.toMatchObject({
				failure: { code: 'staged-input-expired', retryable: false },
			});
		});

		it('gives a transfer that failed before completing the 24-hour window', async () => {
			const context = createRetentionLibrary();
			context.staging.injectTransientFailure('create', 2);
			const operation = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'mid-transfer-failure',
				initiatedBy: 'retention-author',
				name: 'Interrupted transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				browserDecodeEvidence: decodeEvidence(pixelPng),
				declaredByteLength: pixelPng.byteLength,
			});
			const failed = await context.library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				declaredMime: 'image/png',
				bytes: createBoundedByteStream(pixelPng, {
					byteLength: pixelPng.byteLength,
					maximumByteLength: pixelPng.byteLength,
				}),
			});
			// The transfer never completed, so this is an incomplete transfer even
			// though its stage is now 'failed'.
			expect(failed).toMatchObject({
				stage: 'failed',
				failure: { code: 'staging-unavailable', retryable: true },
			});

			const overview = await context.library.getRetentionOverview();
			expect(overview.stagedInput).toEqual([
				expect.objectContaining({
					operationId: operation.id,
					transferComplete: false,
					expiresAt: new Date(
						new Date(failed.updatedAt).getTime() + DAY,
					).toISOString(),
				}),
			]);

			const lastCheckpoint = new Date(failed.updatedAt).getTime();
			context.advanceTo(new Date(lastCheckpoint + DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 0,
			});

			context.advanceTo(new Date(lastCheckpoint + DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 1,
				expiredCompletedInput: 0,
			});
		});

		it('keeps the seven-day promise for input already staged when the migration lands', async () => {
			// Operations that were mid-flight when the transfer-completed column
			// arrived must not be re-read as incomplete transfers: that would cut
			// their promised seven days down to 24 hours.
			await harness.close();
			harness = await createSqliteD1Harness({ throughMigration: '0014' });
			const stagedAt = new Date('2026-07-28T00:00:00.000Z').getTime();
			await harness.client.execute({
				sql: `
					INSERT INTO graphics_ingestion_operations (
						id, idempotency_key, source, stage, initiated_by, proposed_name,
						duplicate_content_policy, declared_byte_length,
						transferred_byte_length, staging_reserved_byte_length,
						staging_used_byte_length, canonical_reserved_byte_length,
						created_at, updated_at
					) VALUES (
						'awaiting-operation', 'pre-migration', 'local-upload',
						'awaiting-confirmation', 'retention-author', 'Awaiting font',
						'reuse', 100, 100, 0, 100, 0, ?, ?
					)
				`,
				args: [stagedAt, stagedAt],
			});
			await harness.applyRemainingMigrations();

			const context = createRetentionLibrary();
			await expect(context.library.getRetentionOverview()).resolves.toMatchObject({
				stagedInput: [
					expect.objectContaining({
						operationId: 'awaiting-operation',
						transferComplete: true,
						expiresAt: new Date(stagedAt + 7 * DAY).toISOString(),
					}),
				],
			});

			context.advanceTo(new Date(stagedAt + 7 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 0,
			});

			context.advanceTo(new Date(stagedAt + 7 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 1,
			});
		});

		it('gives an approved remote copy awaiting confirmation the seven-day promise', async () => {
			// A remote copy stages its complete input through its own path rather
			// than the streamed-upload one. If that path skipped the durable
			// transfer-completed fact, the copy would read as an incomplete
			// transfer and be expired after 24 hours instead of the seven days its
			// staged input was promised.
			const context = createRetentionLibrary({
				remoteSource: {
					async open() {
						return {
							outcome: 'open',
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
			const operation = await context.library.initiateRemoteGraphicAssetCopy({
				idempotencyKey: 'remote-copy-retention',
				initiatedBy: 'retention-author',
				name: 'Remote copy awaiting confirmation',
				sourceFileName: 'logo.png',
			});
			const copied = await context.library.copyRemoteGraphicAssetSource({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				sourceUrl: 'https://cdn.example.test/logo.png',
			});
			expect(copied).toMatchObject({ stage: 'awaiting-confirmation' });
			// Expiry runs from the operation's last durable checkpoint, which its
			// staging transitions advance past the initiation instant.
			const stagedAt = new Date(copied.updatedAt).getTime();

			await expect(context.library.getRetentionOverview()).resolves.toMatchObject({
				stagedInput: [
					expect.objectContaining({
						operationId: operation.id,
						transferComplete: true,
						expiresAt: new Date(stagedAt + 7 * DAY).toISOString(),
					}),
				],
			});

			context.advanceTo(new Date(stagedAt + 7 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 0,
			});
			await expect(context.library.getIngestionOperation({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			})).resolves.toMatchObject({ stage: 'awaiting-confirmation' });

			context.advanceTo(new Date(stagedAt + 7 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 1,
			});
		});

		it('gives a staged Template Package awaiting installation the seven-day promise', async () => {
			// A Template Package stages a complete input exactly like an upload, and
			// then rests while it waits to be installed. If that resting stage were
			// not recognised as holding staged input, the package would either be
			// expired against the 24-hour incomplete-transfer guarantee or never
			// reclaimed at all — and its author was promised seven days.
			const context = createRetentionLibrary();
			const backdrop = await ingestAsset(context, {
				idempotencyKey: 'package-source',
				name: 'Backdrop',
			});
			const exported = await context.library.exportTemplatePackage({
				packageKind: 'skgraphic',
				template: {
					identity: 'template-1',
					name: 'Lower third',
					document: {
						backdrop: {
							assetId: backdrop.result!.assetId,
							revisionId: backdrop.result!.revisionId,
						},
					},
				},
				assets: [{
					slot: 'backdrop',
					reference: {
						assetId: backdrop.result!.assetId,
						revisionId: backdrop.result!.revisionId,
					},
				}],
			});
			if (exported.outcome !== 'exported')
				throw new Error('Expected the fixture package to export');
			const archive = await collectStream(exported.package.open());

			const operation = await context.library.initiateTemplatePackagePreflight({
				idempotencyKey: 'package-retention',
				initiatedBy: 'retention-author',
				sourceFileName: 'lower-third.skgraphic',
				declaredByteLength: archive.byteLength,
			});
			const staged = await context.library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				bytes: createBoundedByteStream(archive, {
					byteLength: archive.byteLength,
					maximumByteLength: archive.byteLength,
				}),
			});
			expect(staged).toMatchObject({ stage: 'awaiting-installation' });
			const stagedAt = new Date(staged.updatedAt).getTime();

			await expect(context.library.getRetentionOverview()).resolves.toMatchObject({
				stagedInput: [
					expect.objectContaining({
						operationId: operation.id,
						transferComplete: true,
						expiresAt: new Date(stagedAt + 7 * DAY).toISOString(),
					}),
				],
			});

			// A day is not enough to reclaim it, seven days is.
			context.advanceTo(new Date(stagedAt + DAY + 1).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 0,
			});
			context.advanceTo(new Date(stagedAt + 7 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 1,
			});
		});

		it('cancels expiry when a durable checkpoint advanced since observation', async () => {
			const context = createRetentionLibrary();
			const resumed = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'progress-cancels-expiry',
				initiatedBy: 'retention-author',
				name: 'Resumed transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				browserDecodeEvidence: decodeEvidence(pixelPng),
				declaredByteLength: pixelPng.byteLength,
			});
			context.advance(DAY + 1);
			await context.library.uploadGraphicAsset({
				operationId: resumed.id,
				initiatedBy: resumed.initiatedBy,
				declaredMime: 'image/png',
				bytes: createBoundedByteStream(pixelPng, {
					byteLength: pixelPng.byteLength,
					maximumByteLength: pixelPng.byteLength,
				}),
			});

			const swept = await context.library.runGraphicsRetention();
			expect(swept.stagedInput.expiredIncompleteTransfers).toBe(0);
			await expect(context.library.getIngestionOperation({
				operationId: resumed.id,
				initiatedBy: resumed.initiatedBy,
			})).resolves.toMatchObject({ stage: 'completed' });
		});

		it('records Evidence for each expiry without exposing object keys or filenames', async () => {
			const context = createRetentionLibrary();
			const abandoned = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'expiry-evidence',
				initiatedBy: 'retention-author',
				name: 'Abandoned transfer',
				sourceFileName: 'secret-artwork.png',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});
			context.advance(DAY + 1);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.evidence.recorded).toBe(1);

			const ledger = await evidenceOf(context.library);
			expect(ledger).toEqual([
				expect.objectContaining({
					category: 'staged-input-expired',
					actor: 'graphics-retention-policy',
					subject: {
						kind: 'graphics-ingestion-operation',
						id: abandoned.id,
					},
					outcome: 'staged-input-expired',
					reason: 'incomplete-transfer-without-verified-progress',
					correlationId: swept.correlationId,
					recordedAt: context.now().toISOString(),
					expiresAt: new Date(
						context.now().getTime() + 365 * DAY,
					).toISOString(),
					detail: expect.objectContaining({
						bytesFreed: pixelPng.byteLength,
						deadline: new Date(
							new Date(abandoned.createdAt).getTime() + DAY,
						).toISOString(),
					}),
				}),
			]);
			expect(JSON.stringify(ledger)).not.toContain('secret-artwork');
			expect(JSON.stringify(ledger)).not.toContain('ingestion/');
			expect(JSON.stringify(ledger)).not.toContain(digestOf(pixelPng));
		});

		it('expires Evidence one year after it was recorded', async () => {
			const context = createRetentionLibrary();
			await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'evidence-expiry',
				initiatedBy: 'retention-author',
				name: 'Abandoned transfer',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});
			context.advance(DAY + 1);
			await context.library.runGraphicsRetention();
			expect(await evidenceOf(context.library)).toHaveLength(1);

			context.advance(365 * DAY - 1);
			await context.library.runGraphicsRetention();
			expect(await evidenceOf(context.library)).toHaveLength(1);

			context.advance(1);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.evidence.expired).toBe(1);
			expect(await evidenceOf(context.library)).toEqual([]);
		});

		it('releases the staging reservation and staged bytes it expired', async () => {
			const context = createRetentionLibrary();
			const abandoned = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'expiry-releases-capacity',
				initiatedBy: 'retention-author',
				name: 'Abandoned transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});
			expect((await context.library.getCapacity()).staging.reservedBytes)
				.toBe(pixelPng.byteLength);

			context.advance(DAY + 1);
			await context.library.runGraphicsRetention();

			const capacity = await context.library.getCapacity();
			expect(capacity.staging.reservedBytes).toBe(0);
			expect(capacity.staging.usedBytes).toBe(0);
			await expect(context.staging.readMetadata(
				graphicsObjectIdentity(`ingestion/${abandoned.id}/source`),
			)).resolves.toMatchObject({ outcome: 'missing' });
		});

		it('aborts a remote copy multipart upload its own request could not release', async () => {
			const oversized = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 4096);
			oversized.set(pixelPng, 0);
			const delegate = createInMemoryStagingGraphicsObjectStore();
			let uploadId: GraphicsMultipartUploadIdentity | undefined;
			const staging: InMemoryGraphicsStagingObjectStore = {
				...delegate,
				async beginMultipart(input) {
					const started = await delegate.beginMultipart(input);
					if (started.outcome === 'started')
						uploadId = started.upload.uploadId;
					return started;
				},
			};
			const context = createRetentionLibrary({
				staging,
				remoteSource: createGraphicsRemoteSourceFetcher({
					resolver: {
						async resolve() {
							return { outcome: 'resolved', addresses: ['93.184.216.34'] };
						},
					},
					// No declared length, so the copy discovers it while reading and
					// takes the resumable multipart path.
					async fetch() {
						return new Response(oversized, { status: 200 });
					},
				}),
			});
			const stranded = await context.library.initiateRemoteGraphicAssetCopy({
				idempotencyKey: 'stranded-remote-copy-upload',
				initiatedBy: 'retention-author',
				name: 'Interrupted remote source',
				sourceFileName: 'logo.png',
			});
			const identity = graphicsObjectIdentity(`ingestion/${stranded.id}/source`);

			// The part fails and the request's own abort cannot land either, which
			// is what a worker death leaves behind.
			staging.injectTransientFailure('multipart-upload-part');
			staging.injectTransientFailure('multipart-abort');
			await context.library.copyRemoteGraphicAssetSource({
				operationId: stranded.id,
				initiatedBy: stranded.initiatedBy,
				sourceUrl: 'https://cdn.example.test/scoreboard.png',
			});
			await expect(
				staging.resumeMultipart(identity, uploadId!),
			).resolves.toMatchObject({ outcome: 'resumed' });

			context.advance(DAY + HOUR);
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 1,
				expiredCompletedInput: 0,
			});

			await expect(
				staging.resumeMultipart(identity, uploadId!),
			).resolves.toMatchObject({ outcome: 'unavailable' });
		});

		it('reports no reclaimed bytes when the multipart abort could not land', async () => {
			const oversized = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 4096);
			oversized.set(pixelPng, 0);
			const delegate = createInMemoryStagingGraphicsObjectStore();
			let uploadId: GraphicsMultipartUploadIdentity | undefined;
			const staging: InMemoryGraphicsStagingObjectStore = {
				...delegate,
				async beginMultipart(input) {
					const started = await delegate.beginMultipart(input);
					if (started.outcome === 'started')
						uploadId = started.upload.uploadId;
					return started;
				},
			};
			const context = createRetentionLibrary({
				staging,
				remoteSource: createGraphicsRemoteSourceFetcher({
					resolver: {
						async resolve() {
							return { outcome: 'resolved', addresses: ['93.184.216.34'] };
						},
					},
					async fetch() {
						return new Response(oversized, { status: 200 });
					},
				}),
			});
			const stranded = await context.library.initiateRemoteGraphicAssetCopy({
				idempotencyKey: 'unabortable-remote-copy-upload',
				initiatedBy: 'retention-author',
				name: 'Interrupted remote source',
				sourceFileName: 'logo.png',
			});
			const identity = graphicsObjectIdentity(`ingestion/${stranded.id}/source`);
			staging.injectTransientFailure('multipart-upload-part');
			staging.injectTransientFailure('multipart-abort');
			await context.library.copyRemoteGraphicAssetSource({
				operationId: stranded.id,
				initiatedBy: stranded.initiatedBy,
				sourceUrl: 'https://cdn.example.test/scoreboard.png',
			});

			// The sweep's own abort finds the store unavailable too, so the upload
			// it was going to reclaim is still holding its parts afterwards.
			staging.injectTransientFailure('multipart-abort');
			context.advance(DAY + HOUR);
			await context.library.runGraphicsRetention();

			await expect(
				staging.resumeMultipart(identity, uploadId!),
			).resolves.toMatchObject({ outcome: 'resumed' });
			const [entry] = await evidenceOf(context.library, {
				categories: ['staged-input-expired'],
			});
			expect(entry).toMatchObject({
				subject: { kind: 'graphics-ingestion-operation', id: stranded.id },
			});
			expect(entry?.detail.bytesFreed).toBeUndefined();
		});

		it('reports retained bytes rather than reclaimed ones when the staged objects survive', async () => {
			const context = createRetentionLibrary();
			context.canonical.injectTransientFailure('create', 2);
			const operation = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'unreleasable-staged-input',
				initiatedBy: 'retention-author',
				name: 'Interrupted publication',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				browserDecodeEvidence: decodeEvidence(pixelPng),
				declaredByteLength: pixelPng.byteLength,
			});
			const failed = await context.library.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				declaredMime: 'image/png',
				bytes: createBoundedByteStream(pixelPng, {
					byteLength: pixelPng.byteLength,
					maximumByteLength: pixelPng.byteLength,
				}),
			});
			const identity = graphicsObjectIdentity(`ingestion/${operation.id}/source`);
			await expect(context.staging.readMetadata(identity))
				.resolves
				.toMatchObject({ outcome: 'available' });

			context.advanceTo(new Date(new Date(failed.updatedAt).getTime() + 7 * DAY).toISOString());
			context.staging.injectTransientFailure('delete', 2);
			const swept = await context.library.runGraphicsRetention();

			// The catalogue row is expired — the sweep claimed it before it acted —
			// but the bytes it claimed are still occupying the staging store, so the
			// Evidence records them as retained rather than as freed.
			expect(swept.stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 1,
			});
			await expect(context.staging.readMetadata(identity))
				.resolves
				.toMatchObject({ outcome: 'available' });
			const [entry] = await evidenceOf(context.library, {
				categories: ['staged-input-expired'],
			});
			expect(entry).toMatchObject({
				subject: { kind: 'graphics-ingestion-operation', id: operation.id },
			});
			expect(entry?.detail.bytesFreed).toBeUndefined();
			expect(entry?.detail.bytesReserved).toBe(pixelPng.byteLength);
		});

		it('leaves the rest of the batch for the next sweep once the store is unavailable', async () => {
			const context = createRetentionLibrary();
			const first = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'unavailable-store-first',
				initiatedBy: 'retention-author',
				name: 'First abandoned transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});
			context.advance(1000);
			const second = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'unavailable-store-second',
				initiatedBy: 'retention-author',
				name: 'Second abandoned transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});

			context.advance(DAY + 1);
			// Exactly the two deletes the first candidate needs, so a sweep that
			// carried on would find the store working again for the second one.
			context.staging.injectTransientFailure('delete', 2);
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 1,
				expiredCompletedInput: 0,
			});
			await expect(context.library.getIngestionOperation({
				operationId: first.id,
				initiatedBy: first.initiatedBy,
			})).resolves.toMatchObject({ failure: { code: 'staged-input-expired' } });
			await expect(context.library.getIngestionOperation({
				operationId: second.id,
				initiatedBy: second.initiatedBy,
			})).resolves.toMatchObject({ stage: 'created' });

			context.advance(1000);
			expect((await context.library.runGraphicsRetention()).stagedInput).toEqual({
				expiredIncompleteTransfers: 1,
				expiredCompletedInput: 0,
			});
			const ledger = await evidenceOf(context.library, {
				categories: ['staged-input-expired'],
			});
			expect(ledger.map(entry => [entry.subject.id, entry.detail.bytesFreed])).toEqual([
				[second.id, pixelPng.byteLength],
				[first.id, undefined],
			]);
		});

		it('releases nothing for a candidate whose expiry did not commit', async () => {
			// A refused claim has to leave the staging store untouched; the order
			// this pins, and why it is that way round, is stated where it is
			// decided, above the release call in expireStagedInput.
			const catalogue = {
				...createD1GraphicsAssetCatalogue(harness.database),
				async expireStagedInput() {
					return false;
				},
			};
			const context = createRetentionLibrary({ catalogue });
			const resumed = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'claim-refused-keeps-objects',
				initiatedBy: 'retention-author',
				name: 'Resumed transfer',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				browserDecodeEvidence: decodeEvidence(pixelPng),
				declaredByteLength: pixelPng.byteLength,
			});
			context.canonical.injectTransientFailure('create', 2);
			await context.library.uploadGraphicAsset({
				operationId: resumed.id,
				initiatedBy: resumed.initiatedBy,
				declaredMime: 'image/png',
				bytes: createBoundedByteStream(pixelPng, {
					byteLength: pixelPng.byteLength,
					maximumByteLength: pixelPng.byteLength,
				}),
			});
			const identity = graphicsObjectIdentity(`ingestion/${resumed.id}/source`);

			context.advance(8 * DAY);
			const swept = await context.library.runGraphicsRetention();

			expect(swept.stagedInput).toEqual({
				expiredIncompleteTransfers: 0,
				expiredCompletedInput: 0,
			});
			await expect(context.staging.readMetadata(identity))
				.resolves
				.toMatchObject({ outcome: 'available' });
			expect(await evidenceOf(context.library, {
				categories: ['staged-input-expired'],
			})).toEqual([]);
		});
	});

	describe('revision pruning', () => {
		it('keeps the latest revision while its Graphic Asset exists', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'latest-revision-retained',
				name: 'Only revision',
			});
			const { assetId, revisionId } = published.result!;

			context.advance(200 * DAY);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.revisions).toEqual({
				pruningScheduled: 0,
				pruningCancelled: 0,
				pruned: 0,
			});
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId,
			})).resolves.toMatchObject({ outcome: 'available' });
		});

		it('retains a referenced superseded revision without a time limit', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'referenced-superseded',
				name: 'Referenced history',
			});
			const { assetId, revisionId: firstRevisionId } = published.result!;
			await addReference({
				referenceId: 'reference-pinned-first',
				assetId,
				revisionId: firstRevisionId,
			});
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'referenced-superseded-replacement',
				bytes: replacementPng,
			});

			context.advance(200 * DAY);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.revisions.pruningScheduled).toBe(0);
			expect(swept.revisions.pruned).toBe(0);
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId: firstRevisionId,
			})).resolves.toMatchObject({ outcome: 'available' });
		});

		it('prunes an unreferenced superseded revision 90 days after its last reference disappears', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'superseded-pruning',
				name: 'Pruned history',
			});
			const { assetId, revisionId: firstRevisionId } = published.result!;
			await addReference({
				referenceId: 'reference-before-pruning',
				assetId,
				revisionId: firstRevisionId,
			});
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'superseded-pruning-replacement',
				bytes: replacementPng,
			});
			expect((await context.library.runGraphicsRetention()).revisions.pruningScheduled).toBe(0);

			await removeReference('reference-before-pruning');
			const unreferencedAt = context.now().getTime();
			expect((await context.library.runGraphicsRetention()).revisions).toEqual({
				pruningScheduled: 1,
				pruningCancelled: 0,
				pruned: 0,
			});

			context.advanceTo(new Date(unreferencedAt + 90 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).revisions.pruned).toBe(0);
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId: firstRevisionId,
			})).resolves.toMatchObject({ outcome: 'available' });

			context.advanceTo(new Date(unreferencedAt + 90 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).revisions.pruned).toBe(1);
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId: firstRevisionId,
			})).resolves.toEqual({ outcome: 'missing' });
			const [asset] = await context.library.listGraphicAssets({});
			expect(asset!.revisions.map(revision => revision.id))
				.not
				.toContain(firstRevisionId);
		});

		it('cancels pruning when a new reference pins the superseded revision', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'pruning-cancelled',
				name: 'Rescued history',
			});
			const { assetId, revisionId: firstRevisionId } = published.result!;
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'pruning-cancelled-replacement',
				bytes: replacementPng,
			});
			await expect(context.library.inspectGraphicAssetRetention({ assetId }))
				.resolves
				.toMatchObject({
					revisions: [
						expect.objectContaining({
							revisionId: firstRevisionId,
							retention: expect.objectContaining({ policy: 'unreferenced-superseded' }),
						}),
						expect.anything(),
					],
				});

			await addReference({
				referenceId: 'reference-cancels-pruning',
				assetId,
				revisionId: firstRevisionId,
			});
			expect((await context.library.runGraphicsRetention()).revisions).toEqual({
				pruningScheduled: 0,
				pruningCancelled: 1,
				pruned: 0,
			});

			context.advance(200 * DAY);
			expect((await context.library.runGraphicsRetention()).revisions.pruned).toBe(0);
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId: firstRevisionId,
			})).resolves.toMatchObject({ outcome: 'available' });
		});

		it('freezes pruning in Trash and resumes the remaining recovery time on restoration', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'pruning-frozen',
				name: 'Frozen history',
			});
			const { assetId, revisionId: firstRevisionId } = published.result!;
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'pruning-frozen-replacement',
				bytes: replacementPng,
			});
			const scheduledAt = context.now().getTime();

			context.advanceTo(new Date(scheduledAt + 89 * DAY).toISOString());
			await context.library.trashGraphicAsset({ assetId });

			// The 90-day deadline passes while the asset is Trashed; pruning is frozen.
			context.advanceTo(new Date(scheduledAt + 109 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).revisions.pruned).toBe(0);
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId: firstRevisionId,
			})).resolves.toMatchObject({ outcome: 'available' });

			await context.library.restoreGraphicAsset({ assetId });
			const restoredAt = context.now().getTime();

			context.advanceTo(new Date(restoredAt + DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).revisions.pruned).toBe(0);

			context.advanceTo(new Date(restoredAt + DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).revisions.pruned).toBe(1);
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId: firstRevisionId,
			})).resolves.toEqual({ outcome: 'missing' });
		});
	});

	describe('final purge', () => {
		it('purges Trash after 30 days, recording a tombstone and Evidence', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'scheduled-purge',
				name: 'Discarded logo',
			});
			const { assetId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			const trashedAt = context.now().getTime();

			context.advanceTo(new Date(trashedAt + 30 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).trash.purged).toBe(0);
			await expect(context.library.listGraphicAssets({
				lifecycleStates: ['trashed'],
			})).resolves.toHaveLength(1);

			context.advanceTo(new Date(trashedAt + 30 * DAY).toISOString());
			const swept = await context.library.runGraphicsRetention();
			expect(swept.trash).toEqual({ purged: 1, blockedByReferences: 0 });
			await expect(context.library.listGraphicAssets({
				lifecycleStates: ['active', 'retired', 'trashed'],
			})).resolves.toEqual([]);
			await expect(context.library.restoreGraphicAsset({ assetId }))
				.rejects
				.toMatchObject({ code: 'ingestion-operation-not-found' });

			const purgeEvidence = await evidenceOf(context.library, {
				categories: ['graphic-asset-purged'],
			});
			expect(purgeEvidence).toEqual([
				expect.objectContaining({
					category: 'graphic-asset-purged',
					subject: { kind: 'graphic-asset', id: assetId },
					outcome: 'graphic-asset-purged',
					reason: 'trash-window-elapsed',
					detail: expect.objectContaining({
						referenceCount: 0,
						revisionCount: 1,
					}),
				}),
			]);
		});

		it('refuses to purge when a fresh reference proof finds usage', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'purge-blocked',
				name: 'Contested logo',
			});
			const { assetId, revisionId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			const trashedAt = context.now().getTime();
			await addReference({
				referenceId: 'reference-races-purge',
				assetId,
				revisionId,
			});

			context.advanceTo(new Date(trashedAt + 30 * DAY).toISOString());
			const swept = await context.library.runGraphicsRetention();
			expect(swept.trash).toEqual({ purged: 0, blockedByReferences: 1 });
			await expect(context.library.listGraphicAssets({
				lifecycleStates: ['trashed'],
			})).resolves.toHaveLength(1);
			await expect(evidenceOf(context.library, {
				categories: ['graphic-asset-purge-blocked'],
			})).resolves.toEqual([
				expect.objectContaining({
					subject: { kind: 'graphic-asset', id: assetId },
					outcome: 'graphic-asset-retained',
					reason: 'reference-proof-found-usage',
					detail: expect.objectContaining({ referenceCount: 1 }),
				}),
			]);
		});

		it('lets a confirmed administrator purge unreferenced Trash early', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'early-purge',
				name: 'Reclaimed logo',
			});
			const { assetId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });

			await expect(context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'not-a-confirmation' as 'purge-now',
			})).rejects.toMatchObject({ code: 'invalid-ingestion-input' });

			context.advance(DAY);
			await expect(context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			})).resolves.toEqual({
				outcome: 'purged',
				assetId,
				purgedAt: context.now().toISOString(),
				revisionCount: 1,
				referenceCount: 0,
				reason: 'early-purge',
			});
			await expect(context.library.listGraphicAssets({
				lifecycleStates: ['active', 'retired', 'trashed'],
			})).resolves.toEqual([]);
			await expect(evidenceOf(context.library, {
				categories: ['graphic-asset-purged'],
			})).resolves.toEqual([
				expect.objectContaining({
					actor: 'installation-administrator',
					reason: 'early-purge',
				}),
			]);
		});

		it('reports usage instead of purging a referenced Trashed Graphic Asset early', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'early-purge-blocked',
				name: 'Contested logo',
			});
			const { assetId, revisionId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			await addReference({ referenceId: 'reference-blocks-early-purge', assetId, revisionId });

			await expect(context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			})).resolves.toMatchObject({
				outcome: 'in-use',
				usage: [expect.objectContaining({ reference: { assetId, revisionId } })],
			});
			await expect(context.library.listGraphicAssets({
				lifecycleStates: ['trashed'],
			})).resolves.toHaveLength(1);
		});

		it('refuses to purge a Graphic Asset that is not in Trash', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'purge-active',
				name: 'Active logo',
			});
			await expect(context.library.purgeTrashedGraphicAsset({
				assetId: published.result!.assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			})).rejects.toMatchObject({
				code: 'graphic-asset-lifecycle-action-not-allowed',
			});
		});

		it('leaves a tombstone that explains the purge but satisfies no reference', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'tombstone-satisfies-nothing',
				name: 'Tombstoned logo',
			});
			const { assetId, revisionId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			await context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			});
			const purgedAt = context.now().getTime();

			// The tombstone outlives the asset and is what explains a later
			// provenance question about this identity.
			const tombstone = await harness.client.execute({
				sql: 'SELECT purged_at, purge_reason, revision_count, reference_count FROM graphic_asset_tombstones WHERE asset_id = ?',
				args: [assetId],
			});
			expect(tombstone.rows).toHaveLength(1);
			expect(tombstone.rows[0]).toMatchObject({
				purged_at: purgedAt,
				purge_reason: 'early-purge',
				revision_count: 1,
				// A purge only ever commits against a proof of zero references, so
				// a tombstone can carry no other reference count.
				reference_count: 0,
			});

			// What the tombstone must never do is stand in for the asset it
			// replaced. Every existing proof adds a reference before the purge and
			// watches the purge refuse; this is the other direction.
			await expect(addReference({
				referenceId: 'reference-against-tombstone',
				assetId,
				revisionId,
			})).rejects.toThrow();
			const references = await harness.client.execute({
				sql: 'SELECT id FROM graphic_asset_references WHERE asset_id = ?',
				args: [assetId],
			});
			expect(references.rows).toEqual([]);

			// Nor may resolution find anything behind it.
			await expect(context.library.inspectGraphicAssetRevision({ assetId, revisionId }))
				.resolves
				.toEqual({ outcome: 'missing' });
			await expect(context.library.listGraphicAssetUsage({ assetId }))
				.resolves
				.toEqual([]);

			// The ledger reports the tombstone beside the Evidence, because once
			// that Evidence expires an empty page for a purged identity would
			// otherwise be indistinguishable from one that never existed.
			await expect(context.library.listGraphicsAssetEvidence({
				subject: { kind: 'graphic-asset', id: assetId },
			})).resolves.toMatchObject({
				tombstone: {
					assetId,
					purgedAt: new Date(purgedAt).toISOString(),
					reason: 'early-purge',
					revisionCount: 1,
					referenceCount: 0,
				},
			});
			// A live asset has none, so the field is an answer rather than decoration.
			const live = await ingestAsset(context, {
				idempotencyKey: 'tombstone-absent',
				name: 'Living logo',
			});
			await expect(context.library.listGraphicsAssetEvidence({
				subject: { kind: 'graphic-asset', id: live.result!.assetId },
			})).resolves.not.toHaveProperty('tombstone');
		});

		it('never lets re-ingestion reuse a purged local identity', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'tombstoned-identity',
				name: 'Purged logo',
			});
			const { assetId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			await context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			});

			const reusedIdentity = createGraphicsAssetLibrary({
				catalogue: createD1GraphicsAssetCatalogue(harness.database),
				staging: createInMemoryStagingGraphicsObjectStore(),
				canonical: createInMemoryCanonicalGraphicsObjectStore(),
				now: context.now,
				generateIdentity: () => assetId,
			});
			const operation = await reusedIdentity.initiateGraphicsIngestion({
				idempotencyKey: 'tombstoned-identity-reingestion',
				initiatedBy: 'retention-author',
				name: 'Re-ingested logo',
				sourceFileName: 'logo.png',
				declaredMime: 'image/png',
				browserDecodeEvidence: decodeEvidence(pixelPng),
				declaredByteLength: pixelPng.byteLength,
				duplicateContentPolicy: 'create-separate',
			});
			const attempted = await reusedIdentity.uploadGraphicAsset({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				declaredMime: 'image/png',
				bytes: createBoundedByteStream(pixelPng, {
					byteLength: pixelPng.byteLength,
					maximumByteLength: pixelPng.byteLength,
				}),
			});
			expect(attempted.stage).toBe('failed');
			expect(attempted.result).toBeUndefined();
			await expect(reusedIdentity.listGraphicAssets({
				lifecycleStates: ['active', 'retired', 'trashed'],
			})).resolves.toEqual([]);
		});
	});

	describe('shared content garbage collection', () => {
		async function purgeNow(context: RetentionLibrary, assetId: GraphicAssetId) {
			await context.library.trashGraphicAsset({ assetId });
			await context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			});
		}

		it('keeps shared content while any retained revision reaches it', async () => {
			const context = createRetentionLibrary();
			const first = await ingestAsset(context, {
				idempotencyKey: 'shared-content-first',
				name: 'Shared bytes one',
			});
			const second = await ingestAsset(context, {
				idempotencyKey: 'shared-content-second',
				name: 'Shared bytes two',
			});
			const sourceObject = graphicsObjectIdentity(`sha256/${digestOf(pixelPng)}`);

			await purgeNow(context, first.result!.assetId);
			expect((await context.library.runGraphicsRetention()).content.quarantined).toBe(0);
			await expect(context.library.inspectGraphicAssetRevisionContent({
				assetId: second.result!.assetId,
				revisionId: second.result!.revisionId,
			})).resolves.toMatchObject({ outcome: 'available' });

			await purgeNow(context, second.result!.assetId);
			const quarantining = await context.library.runGraphicsRetention();
			expect(quarantining.content).toEqual({
				quarantined: 2,
				quarantineReleased: 0,
				deleted: 0,
				bytesReclaimed: 0,
			});
			await expect(context.canonical.readMetadata(sourceObject))
				.resolves
				.toMatchObject({ outcome: 'available' });
		});

		it('deletes quarantined content only after the seven-day recheck window', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'quarantine-window',
				name: 'Discarded bytes',
			});
			const sourceObject = graphicsObjectIdentity(`sha256/${digestOf(pixelPng)}`);
			await purgeNow(context, published.result!.assetId);
			expect((await context.library.runGraphicsRetention()).content.quarantined).toBe(2);
			const quarantinedAt = context.now().getTime();

			context.advanceTo(new Date(quarantinedAt + 7 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).content.deleted).toBe(0);
			await expect(context.canonical.readMetadata(sourceObject))
				.resolves
				.toMatchObject({ outcome: 'available' });

			context.advanceTo(new Date(quarantinedAt + 7 * DAY).toISOString());
			const swept = await context.library.runGraphicsRetention();
			expect(swept.content.deleted).toBe(2);
			expect(swept.content.bytesReclaimed).toBeGreaterThan(pixelPng.byteLength);
			await expect(context.canonical.readMetadata(sourceObject))
				.resolves
				.toEqual({ outcome: 'missing' });
			await expect(evidenceOf(context.library, {
				categories: ['content-deleted'],
			})).resolves.toEqual([
				expect.objectContaining({
					subject: expect.objectContaining({ kind: 'graphic-asset-content' }),
					outcome: 'content-deleted',
					reason: 'unreachable-after-quarantine-recheck',
				}),
				expect.objectContaining({ outcome: 'content-deleted' }),
			]);
			expect(JSON.stringify(await evidenceOf(context.library)))
				.not
				.toContain(digestOf(pixelPng));
		});

		it('keeps quarantined content re-listable when the byte store is unavailable', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'quarantine-byte-store-unavailable',
				name: 'Stubborn bytes',
			});
			const sourceObject = graphicsObjectIdentity(`sha256/${digestOf(pixelPng)}`);
			await purgeNow(context, published.result!.assetId);
			expect((await context.library.runGraphicsRetention()).content.quarantined).toBe(2);

			context.advance(7 * DAY);
			context.canonical.injectTransientFailure('delete', 2);
			const interrupted = await context.library.runGraphicsRetention();
			expect(interrupted.content.deleted).toBe(0);
			expect(interrupted.content.bytesReclaimed).toBe(0);
			await expect(context.canonical.readMetadata(sourceObject))
				.resolves
				.toMatchObject({ outcome: 'available' });

			// The catalogue must still know about the bytes, so the next sweep
			// reclaims them rather than leaving an object nothing can find.
			const overview = await context.library.getRetentionOverview();
			expect(overview.quarantinedContent).toHaveLength(2);

			const recovered = await context.library.runGraphicsRetention();
			expect(recovered.content.deleted).toBe(2);
			expect(recovered.content.bytesReclaimed).toBeGreaterThan(0);
			await expect(context.canonical.readMetadata(sourceObject))
				.resolves
				.toEqual({ outcome: 'missing' });
			await expect(context.library.getRetentionOverview())
				.resolves
				.toMatchObject({ quarantinedContent: [] });
		});

		it('leaves content another sweep is already deleting alone until its claim goes stale', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'quarantine-concurrent-claim',
				name: 'Contended bytes',
			});
			await purgeNow(context, published.result!.assetId);
			expect((await context.library.runGraphicsRetention()).content.quarantined).toBe(2);
			context.advance(7 * DAY);

			// Stand in for a concurrent sweep that has claimed both rows and is
			// still within its lease.
			const claimedAt = context.now().getTime();
			await harness.client.execute({
				sql: 'UPDATE graphics_content_quarantine SET deleting_since = ?',
				args: [claimedAt],
			});
			const contended = await context.library.runGraphicsRetention();
			expect(contended.content.deleted).toBe(0);
			expect(contended.content.bytesReclaimed).toBe(0);
			await expect(context.library.getRetentionOverview())
				.resolves
				.toMatchObject({ quarantinedContent: [expect.anything(), expect.anything()] });

			// Once that claim is older than its lease, this sweep may reclaim it,
			// and it counts the work exactly once.
			context.advanceTo(new Date(claimedAt + HOUR + 1).toISOString());
			const reclaimed = await context.library.runGraphicsRetention();
			expect(reclaimed.content.deleted).toBe(2);
			await expect(context.library.getRetentionOverview())
				.resolves
				.toMatchObject({ quarantinedContent: [] });
			await expect(evidenceOf(context.library, {
				categories: ['content-deleted'],
			})).resolves.toHaveLength(2);
		});

		it('rechecks reachability and spares content a new revision reaches again', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'quarantine-recheck',
				name: 'Recovered bytes',
			});
			const sourceObject = graphicsObjectIdentity(`sha256/${digestOf(pixelPng)}`);
			await purgeNow(context, published.result!.assetId);
			expect((await context.library.runGraphicsRetention()).content.quarantined).toBe(2);

			context.advance(DAY);
			const reingested = await ingestAsset(context, {
				idempotencyKey: 'quarantine-recheck-reingestion',
				name: 'Recovered bytes again',
			});

			context.advance(30 * DAY);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.content.deleted).toBe(0);
			await expect(context.canonical.readMetadata(sourceObject))
				.resolves
				.toMatchObject({ outcome: 'available' });
			await expect(context.library.inspectGraphicAssetRevisionContent({
				assetId: reingested.result!.assetId,
				revisionId: reingested.result!.revisionId,
			})).resolves.toMatchObject({ outcome: 'available' });
		});

		it('reclaims a pruned revision derivative without touching the retained revision', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'derivative-follows-source',
				name: 'Replaced logo',
			});
			const { assetId, revisionId: firstRevisionId } = published.result!;
			const replaced = await replaceAsset(context, {
				assetId,
				idempotencyKey: 'derivative-follows-source-replacement',
				bytes: replacementPng,
			});
			const firstSourceObject = graphicsObjectIdentity(`sha256/${digestOf(pixelPng)}`);
			const currentSourceObject = graphicsObjectIdentity(
				`sha256/${digestOf(replacementPng)}`,
			);

			context.advance(90 * DAY);
			const pruning = await context.library.runGraphicsRetention();
			expect(pruning.revisions.pruned).toBe(1);
			// Both revisions render the same 1x1 thumbnail, so only the superseded
			// source bytes lose their final reachability; the shared derivative
			// content stays alive through the retained revision's derivative.
			expect(pruning.content.quarantined).toBe(1);

			context.advance(7 * DAY);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.content.deleted).toBe(1);
			await expect(context.canonical.readMetadata(firstSourceObject))
				.resolves
				.toEqual({ outcome: 'missing' });
			await expect(context.canonical.readMetadata(currentSourceObject))
				.resolves
				.toMatchObject({ outcome: 'available' });
			await expect(context.library.inspectGraphicAssetRevisionContent({
				assetId,
				revisionId: replaced.result!.revisionId,
			})).resolves.toMatchObject({ outcome: 'available' });
			await expect(context.library.resolveGraphicAssetThumbnail({ assetId }))
				.resolves
				.toMatchObject({ outcome: 'available' });
			await expect(context.library.inspectGraphicAssetRevision({
				assetId,
				revisionId: firstRevisionId,
			})).resolves.toEqual({ outcome: 'missing' });
		});
	});

	describe('deadline visibility', () => {
		it('states why every revision is retained and when its retention ends', async () => {
			const context = createRetentionLibrary();
			const pinned = await ingestAsset(context, {
				idempotencyKey: 'retention-view-pinned',
				name: 'Pinned history',
			});
			await addReference({
				referenceId: 'reference-retention-view',
				assetId: pinned.result!.assetId,
				revisionId: pinned.result!.revisionId,
			});
			const pinnedReplacement = await replaceAsset(context, {
				assetId: pinned.result!.assetId,
				idempotencyKey: 'retention-view-pinned-replacement',
				bytes: replacementPng,
			});
			await expect(context.library.inspectGraphicAssetRetention({
				assetId: pinned.result!.assetId,
			})).resolves.toEqual({
				assetId: pinned.result!.assetId,
				lifecycle: { state: 'active' },
				revisions: [
					{
						assetId: pinned.result!.assetId,
						revisionId: pinned.result!.revisionId,
						revisionNumber: 1,
						retention: { policy: 'referenced', referenceCount: 1 },
					},
					{
						assetId: pinned.result!.assetId,
						revisionId: pinnedReplacement.result!.revisionId,
						revisionNumber: 2,
						retention: { policy: 'latest-revision' },
					},
				],
			});
		});

		it('freezes and resumes the exposed revision deadline with Trash', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'retention-view-frozen',
				name: 'Frozen history',
			});
			const { assetId, revisionId: firstRevisionId } = published.result!;
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'retention-view-frozen-replacement',
				bytes: replacementPng,
			});
			const supersededAt = context.now().getTime();
			const view = await context.library.inspectGraphicAssetRetention({ assetId });
			expect(view.revisions[0]!.retention).toEqual({
				policy: 'unreferenced-superseded',
				unreferencedSince: new Date(supersededAt).toISOString(),
				pruneAfter: new Date(supersededAt + 90 * DAY).toISOString(),
			});

			context.advance(10 * DAY);
			await context.library.trashGraphicAsset({ assetId });
			const trashedAt = context.now().getTime();
			const frozen = await context.library.inspectGraphicAssetRetention({ assetId });
			expect(frozen).toMatchObject({
				lifecycle: {
					state: 'trashed',
					recoverableUntil: new Date(trashedAt + 30 * DAY).toISOString(),
				},
			});
			expect(frozen.revisions[0]!.retention).toEqual({
				policy: 'pruning-frozen',
				unreferencedSince: new Date(supersededAt).toISOString(),
				frozenAt: new Date(trashedAt).toISOString(),
				remainingMilliseconds: 80 * DAY,
			});

			context.advance(5 * DAY);
			await context.library.restoreGraphicAsset({ assetId });
			const restoredAt = context.now().getTime();
			await expect(context.library.inspectGraphicAssetRetention({ assetId }))
				.resolves
				.toMatchObject({
					revisions: [
						expect.objectContaining({
							revisionId: firstRevisionId,
							retention: {
								policy: 'unreferenced-superseded',
								unreferencedSince: new Date(supersededAt).toISOString(),
								pruneAfter: new Date(restoredAt + 80 * DAY).toISOString(),
							},
						}),
						expect.objectContaining({ retention: { policy: 'latest-revision' } }),
					],
				});
		});

		it('records Evidence when Trash freezes and restoration resumes pruning', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'retention-transition-evidence',
				name: 'Frozen history',
			});
			const { assetId, revisionId: firstRevisionId } = published.result!;
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'retention-transition-evidence-replacement',
				bytes: replacementPng,
			});
			const supersededAt = context.now().getTime();

			context.advance(20 * DAY);
			await context.library.trashGraphicAsset({ assetId });
			await expect(evidenceOf(context.library, {
				categories: ['revision-pruning-frozen'],
			})).resolves.toEqual([
				expect.objectContaining({
					subject: { kind: 'graphic-asset-revision', id: firstRevisionId },
					outcome: 'revision-pruning-frozen',
					reason: 'trash-freezes-revision-pruning',
					detail: {
						remainingMilliseconds: 70 * DAY,
						transition: {
							from: 'unreferenced-superseded',
							to: 'pruning-frozen',
						},
					},
				}),
			]);

			context.advance(DAY);
			await context.library.restoreGraphicAsset({ assetId });
			await expect(evidenceOf(context.library, {
				categories: ['revision-pruning-resumed'],
			})).resolves.toEqual([
				expect.objectContaining({
					subject: { kind: 'graphic-asset-revision', id: firstRevisionId },
					outcome: 'revision-pruning-resumed',
					reason: 'restoration-resumes-remaining-recovery-time',
					detail: {
						deadline: new Date(
							supersededAt + 21 * DAY + 70 * DAY,
						).toISOString(),
						transition: {
							from: 'pruning-frozen',
							to: 'unreferenced-superseded',
						},
					},
				}),
			]);
		});

		it('reports every operational deadline in one retention overview', async () => {
			const context = createRetentionLibrary();
			const abandoned = await context.library.initiateGraphicsIngestion({
				idempotencyKey: 'overview-abandoned',
				initiatedBy: 'retention-author',
				name: 'Abandoned transfer',
				declaredMime: 'image/png',
				declaredByteLength: pixelPng.byteLength,
			});
			const startedAt = context.now().getTime();
			const superseded = await ingestAsset(context, {
				idempotencyKey: 'overview-superseded',
				name: 'Replaced logo',
			});
			await replaceAsset(context, {
				assetId: superseded.result!.assetId,
				idempotencyKey: 'overview-superseded-replacement',
				bytes: replacementPng,
			});
			const supersededAt = context.now().getTime();
			const discarded = await ingestAsset(context, {
				idempotencyKey: 'overview-discarded',
				name: 'Discarded logo',
				bytes: replacementPng,
			});
			await context.library.trashGraphicAsset({ assetId: discarded.result!.assetId });
			const trashedAt = context.now().getTime();

			const overview = await context.library.getRetentionOverview();
			expect(overview.checkedAt).toBe(context.now().toISOString());
			expect(overview.guarantees).toEqual({
				incompleteTransferMilliseconds: DAY,
				completedInputMilliseconds: 7 * DAY,
				trashRecoveryMilliseconds: 30 * DAY,
				supersededRevisionMilliseconds: 90 * DAY,
				orphanContentQuarantineMilliseconds: 7 * DAY,
				evidenceMilliseconds: 365 * DAY,
			});
			expect(overview.guaranteesShortenedUnderPressure).toBe(false);
			expect(overview.stagedInput).toEqual([
				expect.objectContaining({
					operationId: abandoned.id,
					stage: 'created',
					transferComplete: false,
					expiresAt: new Date(startedAt + DAY).toISOString(),
				}),
			]);
			expect(overview.trashedAssets).toEqual([
				{
					assetId: discarded.result!.assetId,
					name: 'Discarded logo',
					trashedAt: new Date(trashedAt).toISOString(),
					recoverableUntil: new Date(trashedAt + 30 * DAY).toISOString(),
					referenceCount: 0,
					revisionCount: 1,
				},
			]);
			expect(overview.prunableRevisions).toEqual([
				expect.objectContaining({
					revisionId: superseded.result!.revisionId,
					retention: {
						policy: 'unreferenced-superseded',
						unreferencedSince: new Date(supersededAt).toISOString(),
						pruneAfter: new Date(supersededAt + 90 * DAY).toISOString(),
					},
				}),
			]);
		});

		it('does not shorten any guarantee when canonical capacity is full', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'pressure-does-not-shorten',
				name: 'Discarded logo',
			});
			await replaceAsset(context, {
				assetId: published.result!.assetId,
				idempotencyKey: 'pressure-does-not-shorten-replacement',
				bytes: replacementPng,
			});
			await context.library.trashGraphicAsset({ assetId: published.result!.assetId });
			const relaxed = await context.library.getRetentionOverview();
			expect(relaxed.storagePressure).toBe('normal');

			const capacity = await context.library.getCapacity();
			await context.library.updateCapacityLimits({
				canonicalLimitBytes: capacity.canonical.usedBytes,
				stagingLimitBytes: capacity.staging.limitBytes,
			});

			const pressured = await context.library.getRetentionOverview();
			expect(pressured.storagePressure).toBe('full');
			expect(pressured.guaranteesShortenedUnderPressure).toBe(false);
			expect(pressured.guarantees).toEqual(relaxed.guarantees);
			expect(pressured.trashedAssets).toEqual(relaxed.trashedAssets);
			expect(pressured.prunableRevisions).toEqual(relaxed.prunableRevisions);
			expect((await context.library.runGraphicsRetention()).trash.purged).toBe(0);
		});
	});

	describe('reading the Evidence ledger', () => {
		/**
		 * A ledger with entries from two assets, two actors, and several
		 * categories, so every filter has something it must exclude as well as
		 * something it must find.
		 */
		async function populatedLedger() {
			const context = createRetentionLibrary();
			const first = await ingestAsset(context, {
				idempotencyKey: 'ledger-first',
				name: 'First logo',
			});
			const second = await ingestAsset(context, {
				idempotencyKey: 'ledger-second',
				name: 'Second logo',
			});
			for (const asset of [first, second]) {
				context.advance(HOUR);
				await context.library.retireGraphicAsset({
					assetId: asset.result!.assetId,
					actor: 'librarian',
				});
				context.advance(HOUR);
				await context.library.trashGraphicAsset({
					assetId: asset.result!.assetId,
					actor: 'archivist',
				});
			}
			return { context, first: first.result!, second: second.result! };
		}

		it('narrows by actor, category group, correlation, and time range', async () => {
			const { context, first } = await populatedLedger();

			const byActor = await evidenceOf(context.library, { actor: 'archivist' });
			expect(byActor).toHaveLength(2);
			for (const entry of byActor)
				expect(entry.category).toBe('graphic-asset-trashed');

			// A group is the same question in the operational vocabulary: asking
			// for lifecycle finds retirement and Trash without naming either.
			const byGroup = await context.library.listGraphicsAssetEvidence({
				categories: [...GRAPHICS_EVIDENCE_CATEGORY_GROUPS.lifecycle],
			});
			expect(byGroup.entries).toHaveLength(4);

			const trashed = byActor[0]!;
			const byCorrelation = await evidenceOf(context.library, {
				correlationId: trashed.correlationId,
			});
			expect(byCorrelation).toEqual([trashed]);

			const bySubject = await evidenceOf(context.library, {
				subject: { kind: 'graphic-asset', id: first.assetId },
			});
			expect(bySubject).toHaveLength(2);

			// The range is inclusive at both ends, so an entry recorded exactly on
			// a boundary is inside the window an administrator asked about.
			await expect(evidenceOf(context.library, {
				recordedFrom: trashed.recordedAt,
				recordedUntil: trashed.recordedAt,
			})).resolves.toEqual([trashed]);
		});

		it('walks the whole ledger by cursor without repeating or skipping', async () => {
			const { context } = await populatedLedger();
			const everything = await evidenceOf(context.library);
			expect(everything).toHaveLength(4);

			const first = await context.library.listGraphicsAssetEvidence({ limit: 2 });
			expect(first.entries).toEqual(everything.slice(0, 2));
			// Nothing is newer than the newest page, so there is no way back from
			// where reading started.
			expect(first.newer).toBeNull();
			expect(first.older).toEqual({
				recordedAt: everything[1]!.recordedAt,
				id: everything[1]!.id,
			});

			const second = await context.library.listGraphicsAssetEvidence({
				limit: 2,
				cursor: first.older!,
			});
			expect(second.entries).toEqual(everything.slice(2));
			// The end of the ledger is reported rather than offering a next page
			// that would turn out to be empty.
			expect(second.older).toBeNull();

			const back = await context.library.listGraphicsAssetEvidence({
				limit: 2,
				cursor: second.newer!,
				direction: 'newer',
			});
			expect(back.entries).toEqual(everything.slice(0, 2));
			expect(back.newer).toBeNull();
		});

		it('orders entries sharing an instant by a tiebreak the cursor also uses', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'ledger-same-instant',
				name: 'Simultaneous logo',
			});
			const { assetId, revisionId } = published.result!;
			// A reference holds the first revision out of the retention rows while
			// it is superseded, so once it is released both revisions are scheduled
			// by the same publication and share a recorded instant. That is where a
			// cursor comparing only the timestamp repeats an entry or loses one.
			await addReference({ referenceId: 'reference-same-instant', assetId, revisionId });
			const second = await replaceAsset(context, {
				assetId,
				idempotencyKey: 'ledger-same-instant-second',
				bytes: replacementPng,
			});
			await removeReference('reference-same-instant');
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'ledger-same-instant-third',
				bytes: Uint8Array.of(
					...replacementPng.slice(0, -12),
					...emptyTextChunk,
					...replacementPng.slice(-12),
				),
			});
			const everything = await evidenceOf(context.library);
			expect(everything).toHaveLength(2);
			expect(everything[0]!.recordedAt).toBe(everything[1]!.recordedAt);
			expect(everything.map(entry => entry.subject.id).sort())
				.toEqual([revisionId, second.result!.revisionId].sort());

			const walked = [];
			let cursor = undefined as { recordedAt: string; id: string } | undefined;
			do {
				const page = await context.library.listGraphicsAssetEvidence({
					limit: 1,
					cursor,
				});
				walked.push(...page.entries);
				cursor = page.older ?? undefined;
			} while (cursor);
			expect(walked).toEqual(everything);
		});
	});

	describe('the Evidence that establishes a deadline', () => {
		it('records the Trash recovery deadline with the transition that set it', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'trash-deadline-evidence',
				name: 'Deadline logo',
			});
			const { assetId } = published.result!;
			await context.library.retireGraphicAsset({ assetId, actor: 'librarian' });
			const retiredAt = context.now().toISOString();
			context.advance(HOUR);
			await context.library.trashGraphicAsset({ assetId, actor: 'librarian' });
			const trashedAt = context.now().getTime();

			await expect(evidenceOf(context.library, {
				categories: ['graphic-asset-retired'],
			})).resolves.toEqual([
				expect.objectContaining({
					actor: 'librarian',
					recordedAt: retiredAt,
					subject: { kind: 'graphic-asset', id: assetId },
					detail: expect.objectContaining({
						transition: { from: 'active', to: 'retired' },
					}),
				}),
			]);
			// Trash is entered from Retired here, so the transition records where
			// restoration would put the asset back rather than assuming 'active'.
			await expect(evidenceOf(context.library, {
				categories: ['graphic-asset-trashed'],
			})).resolves.toEqual([
				expect.objectContaining({
					actor: 'librarian',
					subject: { kind: 'graphic-asset', id: assetId },
					detail: expect.objectContaining({
						transition: { from: 'retired', to: 'trashed' },
						deadline: new Date(trashedAt + 30 * DAY).toISOString(),
						remainingMilliseconds: 30 * DAY,
					}),
				}),
			]);

			context.advance(DAY);
			await context.library.restoreGraphicAsset({ assetId, actor: 'librarian' });
			await expect(evidenceOf(context.library, {
				categories: ['graphic-asset-restored'],
			})).resolves.toEqual([
				expect.objectContaining({
					actor: 'librarian',
					detail: expect.objectContaining({
						transition: { from: 'trashed', to: 'retired' },
					}),
				}),
			]);
		});

		it('records the revision retention deadline supersession established', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'supersession-deadline-evidence',
				name: 'Superseded logo',
			});
			const { assetId, revisionId } = published.result!;
			await replaceAsset(context, {
				assetId,
				idempotencyKey: 'supersession-deadline-evidence-replacement',
				bytes: replacementPng,
			});
			const supersededAt = context.now().getTime();

			// The catalogue authors this deadline inside the publication
			// transaction, so without Evidence here the ledger would only ever
			// show the deadline being acted on, never the moment it was set.
			await expect(evidenceOf(context.library, {
				categories: ['revision-pruning-scheduled'],
			})).resolves.toEqual([
				expect.objectContaining({
					actor: 'retention-author',
					subject: { kind: 'graphic-asset-revision', id: revisionId },
					outcome: 'revision-pruning-scheduled',
					reason: 'superseded-by-new-revision',
					detail: expect.objectContaining({
						referenceCount: 0,
						deadline: new Date(supersededAt + 90 * DAY).toISOString(),
						transition: {
							from: 'latest-revision',
							to: 'unreferenced-superseded',
						},
					}),
				}),
			]);
		});

		it('records the deadline and quota state a purge decided against', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'purge-deadline-evidence',
				name: 'Purged logo',
			});
			const { assetId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			const trashedAt = context.now().getTime();

			context.advance(DAY);
			await context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			});

			// An early purge acts against a deadline that has not arrived, which
			// is exactly what distinguishes it from the scheduled purge.
			await expect(evidenceOf(context.library, {
				categories: ['graphic-asset-purged'],
			})).resolves.toEqual([
				expect.objectContaining({
					actor: 'installation-administrator',
					reason: 'early-purge',
					detail: expect.objectContaining({
						referenceCount: 0,
						revisionCount: 1,
						deadline: new Date(trashedAt + 30 * DAY).toISOString(),
						transition: { from: 'trashed', to: 'purged' },
						canonicalPressure: expect.any(String),
						canonicalUsedBytes: expect.any(Number),
					}),
				}),
			]);
		});
	});

	describe('the one-year Evidence window', () => {
		it('keeps Evidence for a subject that has not been cleaned up', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'evidence-live-subject',
				name: 'Living logo',
			});
			const { assetId, revisionId } = published.result!;
			// A referenced asset in Trash is refused at every purge attempt, so it
			// accumulates Evidence while never reaching a terminal cleanup.
			await context.library.trashGraphicAsset({ assetId });
			await addReference({ referenceId: 'reference-keeps-subject-live', assetId, revisionId });
			context.advance(31 * DAY);
			await context.library.runGraphicsRetention();
			const blocked = await evidenceOf(context.library, {
				categories: ['graphic-asset-purge-blocked'],
			});
			expect(blocked).toHaveLength(1);
			// Nothing has been cleaned up, so nothing anchors an expiry yet.
			expect(blocked[0]!.expiresAt).toBeNull();

			context.advance(2 * 365 * DAY);
			const swept = await context.library.runGraphicsRetention();
			expect(swept.evidence.expired).toBe(0);
			await expect(evidenceOf(context.library, {
				categories: ['graphic-asset-purge-blocked'],
				subject: { kind: 'graphic-asset', id: assetId },
			})).resolves.not.toHaveLength(0);
		});

		it('expires a purged asset\'s Evidence one year after the purge, not after the entry', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'evidence-purged-subject',
				name: 'Doomed logo',
			});
			const { assetId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			const trashedAt = context.now().getTime();

			// A year passes before the purge. The entries written at Trash time are
			// older than the window but explain a subject that is still recoverable,
			// so an entry-age anchor would already have destroyed them.
			context.advanceTo(new Date(trashedAt + 366 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).evidence.expired).toBe(0);
			await expect(evidenceOf(context.library, {
				subject: { kind: 'graphic-asset', id: assetId },
			})).resolves.not.toHaveLength(0);

			const purgedAt = context.now().getTime();
			expect((await context.library.listGraphicAssets({
				lifecycleStates: ['trashed'],
			}))).toHaveLength(0);

			const sealed = await evidenceOf(context.library, {
				subject: { kind: 'graphic-asset', id: assetId },
			});
			expect(sealed).not.toHaveLength(0);
			for (const entry of sealed)
				expect(entry.expiresAt).toBe(new Date(purgedAt + 365 * DAY).toISOString());

			context.advanceTo(new Date(purgedAt + 365 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).evidence.expired).toBe(0);
			await expect(evidenceOf(context.library, {
				subject: { kind: 'graphic-asset', id: assetId },
			})).resolves.not.toHaveLength(0);

			context.advanceTo(new Date(purgedAt + 365 * DAY).toISOString());
			expect((await context.library.runGraphicsRetention()).evidence.expired)
				.toBeGreaterThan(0);
			await expect(evidenceOf(context.library, {
				subject: { kind: 'graphic-asset', id: assetId },
			})).resolves.toEqual([]);
		});

		it('keeps Evidence recorded after the anchor readable for its own year', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'evidence-after-the-anchor',
				name: 'Long-remembered logo',
			});
			const { assetId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			await context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			});
			const purgedAt = context.now().getTime();

			// A provenance question about a purged identity can arrive at any time,
			// and the tombstone is there to answer it. Evidence written more than a
			// year after the purge would be sealed already expired against the
			// terminal anchor and destroyed by the same sweep that sealed it.
			context.advanceTo(new Date(purgedAt + 400 * DAY).toISOString());
			const observedAt = context.now().getTime();
			await recordLateEvidence({ id: 'late-observation', assetId, recordedAt: observedAt });

			await context.library.runGraphicsRetention();
			const sealed = await evidenceOf(context.library, {
				subject: { kind: 'graphic-asset', id: assetId },
			});
			expect(sealed).toEqual([
				expect.objectContaining({
					id: 'late-observation',
					// Its own full window, not the anchor's, which has already passed.
					expiresAt: new Date(observedAt + 365 * DAY).toISOString(),
				}),
			]);

			context.advanceTo(new Date(observedAt + 365 * DAY - 1).toISOString());
			expect((await context.library.runGraphicsRetention()).evidence.expired).toBe(0);
			await expect(evidenceOf(context.library, {
				subject: { kind: 'graphic-asset', id: assetId },
			})).resolves.toHaveLength(1);
		});

		it('records no Evidence about expiring Evidence', async () => {
			const context = createRetentionLibrary();
			const published = await ingestAsset(context, {
				idempotencyKey: 'evidence-no-self-reference',
				name: 'Self-referential logo',
			});
			const { assetId } = published.result!;
			await context.library.trashGraphicAsset({ assetId });
			await context.library.purgeTrashedGraphicAsset({
				assetId,
				actor: 'installation-administrator',
				confirmation: 'purge-now',
			});
			// Sweep the content the purge orphaned all the way to deletion, so
			// every subject the asset leaves behind has recorded its own terminal
			// cleanup and the whole ledger is anchored rather than only part of it.
			await context.library.runGraphicsRetention();
			context.advance(8 * DAY);
			await context.library.runGraphicsRetention();
			const settledAt = context.now().getTime();
			expect(await evidenceOf(context.library)).not.toHaveLength(0);

			context.advanceTo(new Date(settledAt + 365 * DAY).toISOString());
			const swept = await context.library.runGraphicsRetention();
			expect(swept.evidence.expired).toBeGreaterThan(0);
			// Sealing and expiry are ledger housekeeping. Recording them in the
			// ledger would write rows that outlive the rows they explain, and the
			// next sweep would then have those to explain in turn.
			expect(swept.evidence.recorded).toBe(0);
			await expect(evidenceOf(context.library))
				.resolves
				.toEqual([]);
		});
	});
});
