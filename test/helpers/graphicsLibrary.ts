/**
 * A Graphics Asset Library on a controlled clock and in-memory object stores,
 * plus the ingest, replace and reference steps the library suites arrange.
 */
import type {
	InMemoryGraphicsCanonicalObjectStore,
	InMemoryGraphicsStagingObjectStore,
} from '~~/server/modules/graphics-asset-library/object-store';
import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsDuplicateContentPolicy,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import { digestOf, pixelPng } from '~~/test/helpers/graphicsFixtures';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

type LibraryDependencies = Parameters<typeof createGraphicsAssetLibrary>[0];

export type TestGraphicsLibraryOptions = Partial<Omit<LibraryDependencies, 'staging' | 'canonical'>> & {
	/** The clock's starting instant. */
	start?: string;
	/** Prefix for minted identities: `<prefix>-1`, `<prefix>-2`, … */
	identityPrefix?: string;
	staging?: InMemoryGraphicsStagingObjectStore;
	canonical?: InMemoryGraphicsCanonicalObjectStore;
};

export function createTestGraphicsLibrary(options: TestGraphicsLibraryOptions & Pick<LibraryDependencies, 'catalogue'>) {
	const {
		start = '2026-07-28T00:00:00.000Z',
		identityPrefix = 'identity',
		staging = createInMemoryStagingGraphicsObjectStore(),
		canonical = createInMemoryCanonicalGraphicsObjectStore(),
		...dependencies
	} = options;
	let currentTime = new Date(start);
	let nextIdentity = 0;
	const library = createGraphicsAssetLibrary({
		staging,
		canonical,
		now: () => currentTime,
		generateIdentity: () => `${identityPrefix}-${++nextIdentity}`,
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

export type TestGraphicsLibrary = ReturnType<typeof createTestGraphicsLibrary>;

/** What a browser reports after decoding a 1×1 image. */
export function decodeEvidence(bytes: Uint8Array, size = { width: 1, height: 1 }) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: digestOf(bytes),
		...size,
	};
}

/** `bytes` as an upload body declared at exactly its own length. */
export function boundedBytes(bytes: Uint8Array) {
	return createBoundedByteStream(bytes, {
		byteLength: bytes.byteLength,
		maximumByteLength: bytes.byteLength,
	});
}

export function canonicalIdentity(digest: string) {
	return graphicsObjectIdentity(`sha256/${digest}`);
}

/** The metadata publication writes beside canonical PNG bytes. */
export function canonicalMetadata(digest: string) {
	return {
		contentType: 'image/png',
		custom: { sha256: digest },
	};
}

export function stagedSourceIdentity(operationId: string) {
	return graphicsObjectIdentity(`ingestion/${operationId}/source`);
}

interface IngestOptions {
	idempotencyKey: string;
	/** Defaults to the idempotency key. */
	name?: string;
	bytes?: Uint8Array;
	initiatedBy?: string;
}

/** Initiate a PNG ingestion without uploading it. */
export async function initiateImage(context: TestGraphicsLibrary, options: IngestOptions & {
	/** `false` initiates without browser decode evidence, as an abandoned transfer does. */
	decoded?: boolean;
	duplicateContentPolicy?: GraphicsDuplicateContentPolicy;
}): Promise<GraphicsIngestionOperation> {
	const bytes = options.bytes ?? pixelPng;
	return await context.library.initiateGraphicsIngestion({
		idempotencyKey: options.idempotencyKey,
		initiatedBy: options.initiatedBy ?? 'graphics-author',
		name: options.name ?? options.idempotencyKey,
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		...(options.decoded === false
			? {}
			: {
					browserDecodeEvidence: decodeEvidence(bytes),
				}),
		declaredByteLength: bytes.byteLength,
		...(options.duplicateContentPolicy
			? { duplicateContentPolicy: options.duplicateContentPolicy }
			: {}),
	});
}

/** Upload `bytes` for an initiated operation. */
export async function uploadImage(context: TestGraphicsLibrary, operation: GraphicsIngestionOperation, bytes: Uint8Array = pixelPng) {
	return await context.library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: boundedBytes(bytes),
	});
}

/** Initiate and upload one PNG as a new Graphic Asset, a second apart. */
export async function ingestImage(context: TestGraphicsLibrary, options: IngestOptions): Promise<GraphicsIngestionOperation> {
	const operation = await initiateImage(context, { ...options, duplicateContentPolicy: 'create-separate' });
	context.advance(1000);
	return await uploadImage(context, operation, options.bytes);
}

/** Initiate and upload a replacement revision of an existing Graphic Asset. */
export async function replaceImage(
	context: TestGraphicsLibrary,
	options: Omit<IngestOptions, 'name' | 'bytes'> & { assetId: GraphicAssetId; bytes: Uint8Array },
): Promise<GraphicsIngestionOperation> {
	const operation = await context.library.initiateGraphicAssetReplacement({
		assetId: options.assetId,
		idempotencyKey: options.idempotencyKey,
		initiatedBy: options.initiatedBy ?? 'graphics-author',
		sourceFileName: 'logo.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: decodeEvidence(options.bytes),
		declaredByteLength: options.bytes.byteLength,
	});
	context.advance(1000);
	return await context.library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: boundedBytes(options.bytes),
	});
}

/** The asset and revision an ingestion published; throws when it published none. */
export function publishedRevision(operation: GraphicsIngestionOperation) {
	if (!operation.result)
		throw new Error(`Ingestion ${operation.id} did not publish a Graphic Asset`);
	return { assetId: operation.result.assetId, revisionId: operation.result.revisionId };
}

/** A Screen-owned reference, written as the Screen reference writer writes it. */
export async function addScreenReference(harness: SqliteD1Harness, input: {
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

export async function removeScreenReference(harness: SqliteD1Harness, referenceId: string) {
	await harness.client.execute({
		sql: 'DELETE FROM graphic_asset_references WHERE id = ?',
		args: [referenceId],
	});
}
