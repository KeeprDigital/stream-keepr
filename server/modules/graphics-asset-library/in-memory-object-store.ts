import type {
	BoundedByteStream,
	CreateImmutableGraphicsObjectInput,
	GraphicsCanonicalObjectStoreOperation,
	GraphicsMultipartPart,
	GraphicsMultipartPartIdentity,
	GraphicsMultipartUpload,
	GraphicsMultipartUploadIdentity,
	GraphicsObjectIdentity,
	GraphicsObjectMetadata,
	GraphicsStagingObjectStoreOperation,
	InMemoryGraphicsCanonicalObjectStore,
	InMemoryGraphicsStagingObjectStore,
} from './object-store';
import {
	consumeBoundedByteStream,
	GraphicsObjectInputError,
	readableBytes,
	unavailableObjectStoreOutcome,
	validateMultipartPartNumber,
	validateRequestedRange,
} from './object-store';

interface StoredObject {
	bytes: Uint8Array;
	metadata: GraphicsObjectMetadata;
}

interface StoredMultipartUpload {
	upload: GraphicsMultipartUpload;
	metadata?: CreateImmutableGraphicsObjectInput['metadata'];
	parts: Map<number, { bytes: Uint8Array; part: GraphicsMultipartPart }>;
}

type InMemoryOperation = GraphicsStagingObjectStoreOperation;

function createInMemoryGraphicsObjectStoreImplementation() {
	const objects = new Map<GraphicsObjectIdentity, StoredObject>();
	const multipartUploads = new Map<GraphicsMultipartUploadIdentity, StoredMultipartUpload>();
	const unavailableObjects = new Set<GraphicsObjectIdentity>();
	const transientFailures = new Map<InMemoryOperation, number>();

	function shouldFailTransiently(operation: InMemoryOperation) {
		const failuresRemaining = transientFailures.get(operation) ?? 0;
		if (failuresRemaining === 0)
			return false;
		transientFailures.set(operation, failuresRemaining - 1);
		return true;
	}

	return {
		async checkHealth() {
			return shouldFailTransiently('health')
				? unavailableObjectStoreOutcome()
				: { outcome: 'healthy' as const };
		},
		async createImmutable(input: CreateImmutableGraphicsObjectInput) {
			if (shouldFailTransiently('create'))
				return unavailableObjectStoreOutcome();
			const existing = objects.get(input.identity);
			if (existing) {
				return {
					outcome: 'already-exists' as const,
					object: existing.metadata,
				};
			}

			const bytes = await consumeBoundedByteStream(input.bytes);

			// Another create may have completed while this stream was consumed.
			// Preserve the first object exactly as an atomic create-if-absent does.
			const concurrent = objects.get(input.identity);
			if (concurrent) {
				return {
					outcome: 'already-exists' as const,
					object: concurrent.metadata,
				};
			}

			const metadata: GraphicsObjectMetadata = {
				identity: input.identity,
				byteLength: bytes.byteLength,
				contentType: input.metadata?.contentType,
				customMetadata: { ...input.metadata?.custom },
				uploadedAt: new Date(),
			};
			objects.set(input.identity, { bytes, metadata });
			return { outcome: 'created' as const, object: metadata };
		},
		async readMetadata(identity: GraphicsObjectIdentity) {
			if (shouldFailTransiently('metadata'))
				return unavailableObjectStoreOutcome();
			const object = objects.get(identity);
			if (!object)
				return { outcome: 'missing' as const };
			if (unavailableObjects.has(identity)) {
				return {
					outcome: 'unavailable' as const,
					reason: { code: 'object-unavailable' as const, retryable: true as const },
				};
			}
			return { outcome: 'available' as const, object: object.metadata };
		},
		async read(identity: GraphicsObjectIdentity, requestedRange?: { offset: number; length: number }) {
			validateRequestedRange(requestedRange);
			if (shouldFailTransiently('read'))
				return unavailableObjectStoreOutcome();
			const stored = objects.get(identity);
			if (!stored)
				return { outcome: 'missing' as const };
			if (unavailableObjects.has(identity)) {
				return {
					outcome: 'unavailable' as const,
					reason: { code: 'object-unavailable' as const, retryable: true as const },
				};
			}

			const offset = requestedRange?.offset ?? 0;
			const length = requestedRange?.length ?? stored.bytes.byteLength;
			if (requestedRange && offset >= stored.bytes.byteLength)
				throw new GraphicsObjectInputError('Range offset must be within the object');
			const availableLength = Math.min(length, stored.bytes.byteLength - offset);

			return {
				outcome: 'available' as const,
				object: stored.metadata,
				body: readableBytes(stored.bytes.slice(offset, offset + availableLength)),
				range: {
					offset,
					length: availableLength,
					completeLength: stored.bytes.byteLength,
				},
			};
		},
		async list(input: { prefix?: string; cursor?: string; limit?: number } = {}) {
			if (shouldFailTransiently('list'))
				return unavailableObjectStoreOutcome();
			// Lexicographic order makes the cursor the last key returned, which is
			// how the production store paginates and is what lets a test advance a
			// scan one bounded page at a time.
			//
			// Listings here carry complete metadata, which matches the R2 adapter
			// only because that adapter explicitly asks for it: an R2 listing
			// without `include` reports no content type and empty custom metadata
			// for every object. If that request is ever dropped, this double will
			// keep passing while production reads every object as a conflict.
			const matching = [...objects.entries()]
				.filter(([identity]) => identity.startsWith(input.prefix ?? ''))
				.filter(([identity]) => input.cursor === undefined || identity > input.cursor)
				.toSorted(([left], [right]) => left.localeCompare(right));
			const limit = input.limit ?? matching.length;
			const page = matching.slice(0, limit);
			return {
				outcome: 'listed' as const,
				listing: {
					objects: page.map(([, stored]) => stored.metadata),
					cursor: matching.length > page.length ? page.at(-1)?.[0] : undefined,
				},
			};
		},
		async beginMultipart(input: Pick<CreateImmutableGraphicsObjectInput, 'identity' | 'metadata'>) {
			if (shouldFailTransiently('multipart-start'))
				return unavailableObjectStoreOutcome();
			const upload: GraphicsMultipartUpload = {
				identity: input.identity,
				uploadId: crypto.randomUUID() as GraphicsMultipartUploadIdentity,
			};
			multipartUploads.set(upload.uploadId, {
				upload,
				metadata: input.metadata,
				parts: new Map(),
			});
			return { outcome: 'started' as const, upload };
		},
		async resumeMultipart(identity: GraphicsObjectIdentity, uploadId: GraphicsMultipartUploadIdentity) {
			if (shouldFailTransiently('multipart-resume'))
				return unavailableObjectStoreOutcome();
			const stored = multipartUploads.get(uploadId);
			return stored?.upload.identity === identity
				? { outcome: 'resumed' as const, upload: stored.upload }
				: unavailableObjectStoreOutcome();
		},
		async uploadPart(input: {
			upload: GraphicsMultipartUpload;
			partNumber: number;
			bytes: BoundedByteStream;
		}) {
			if (shouldFailTransiently('multipart-upload-part'))
				return unavailableObjectStoreOutcome();
			const stored = multipartUploads.get(input.upload.uploadId);
			if (!stored || stored.upload.identity !== input.upload.identity)
				return unavailableObjectStoreOutcome();
			validateMultipartPartNumber(input.partNumber);

			const bytes = await consumeBoundedByteStream(input.bytes);
			const part: GraphicsMultipartPart = {
				partNumber: input.partNumber,
				partIdentity: crypto.randomUUID() as GraphicsMultipartPartIdentity,
				byteLength: bytes.byteLength,
			};
			stored.parts.set(input.partNumber, { bytes, part });
			return { outcome: 'uploaded' as const, part };
		},
		async completeMultipart(input: {
			upload: GraphicsMultipartUpload;
			parts: readonly GraphicsMultipartPart[];
		}) {
			if (shouldFailTransiently('multipart-complete'))
				return unavailableObjectStoreOutcome();
			const storedUpload = multipartUploads.get(input.upload.uploadId);
			if (!storedUpload || storedUpload.upload.identity !== input.upload.identity)
				return unavailableObjectStoreOutcome();

			const requestedParts = input.parts.toSorted((left, right) => left.partNumber - right.partNumber);
			const storedParts = requestedParts.map((part) => {
				validateMultipartPartNumber(part.partNumber);
				const storedPart = storedUpload.parts.get(part.partNumber);
				if (!storedPart || storedPart.part.partIdentity !== part.partIdentity)
					throw new GraphicsObjectInputError(`Multipart part ${part.partNumber} is missing`);
				return storedPart;
			});
			const byteLength = storedParts.reduce((total, part) => total + part.bytes.byteLength, 0);
			const bytes = new Uint8Array(byteLength);
			let offset = 0;
			for (const part of storedParts) {
				bytes.set(part.bytes, offset);
				offset += part.bytes.byteLength;
			}
			const metadata: GraphicsObjectMetadata = {
				identity: input.upload.identity,
				byteLength,
				contentType: storedUpload.metadata?.contentType,
				customMetadata: { ...storedUpload.metadata?.custom },
				uploadedAt: new Date(),
			};
			objects.set(input.upload.identity, { bytes, metadata });
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			multipartUploads.delete(input.upload.uploadId);
			return { outcome: 'created' as const, object: metadata };
		},
		async abortMultipart(upload: GraphicsMultipartUpload) {
			if (shouldFailTransiently('multipart-abort'))
				return unavailableObjectStoreOutcome();
			const stored = multipartUploads.get(upload.uploadId);
			if (!stored || stored.upload.identity !== upload.identity)
				return unavailableObjectStoreOutcome();
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			multipartUploads.delete(upload.uploadId);
			return { outcome: 'aborted' as const };
		},
		async delete(identity: GraphicsObjectIdentity) {
			if (shouldFailTransiently('delete'))
				return unavailableObjectStoreOutcome();
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Set, not a Drizzle table.
			unavailableObjects.delete(identity);
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			return objects.delete(identity)
				? { outcome: 'deleted' as const }
				: { outcome: 'missing' as const };
		},
		markUnavailable(identity: GraphicsObjectIdentity) {
			if (!objects.has(identity))
				throw new Error('Cannot mark a missing graphics object unavailable');
			unavailableObjects.add(identity);
		},
		restore(identity: GraphicsObjectIdentity) {
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Set, not a Drizzle table.
			unavailableObjects.delete(identity);
		},
		injectTransientFailure(operation: InMemoryOperation, count = 1) {
			if (!Number.isSafeInteger(count) || count <= 0)
				throw new Error('Transient failure count must be a positive safe integer');
			transientFailures.set(operation, (transientFailures.get(operation) ?? 0) + count);
		},
	};
}

function canonicalCapabilities(
	implementation: ReturnType<typeof createInMemoryGraphicsObjectStoreImplementation>,
): InMemoryGraphicsCanonicalObjectStore {
	return {
		checkHealth: implementation.checkHealth,
		createImmutable: implementation.createImmutable,
		readMetadata: implementation.readMetadata,
		read: implementation.read,
		list: implementation.list,
		// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory adapter method, not a Drizzle table.
		delete: implementation.delete,
		markUnavailable: implementation.markUnavailable,
		restore: implementation.restore,
		injectTransientFailure: (
			operation: GraphicsCanonicalObjectStoreOperation,
			count?: number,
		) => implementation.injectTransientFailure(operation, count),
	};
}

export function createInMemoryCanonicalGraphicsObjectStore(): InMemoryGraphicsCanonicalObjectStore {
	return canonicalCapabilities(createInMemoryGraphicsObjectStoreImplementation());
}

export function createInMemoryStagingGraphicsObjectStore(): InMemoryGraphicsStagingObjectStore {
	return createInMemoryGraphicsObjectStoreImplementation();
}
