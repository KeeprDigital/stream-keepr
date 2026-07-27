declare const graphicsObjectIdentityBrand: unique symbol;
declare const graphicsMultipartUploadIdentityBrand: unique symbol;
declare const graphicsMultipartPartIdentityBrand: unique symbol;

export type GraphicsObjectIdentity = string & {
	readonly [graphicsObjectIdentityBrand]: 'GraphicsObjectIdentity';
};

export type GraphicsMultipartUploadIdentity = string & {
	readonly [graphicsMultipartUploadIdentityBrand]: 'GraphicsMultipartUploadIdentity';
};

export type GraphicsMultipartPartIdentity = string & {
	readonly [graphicsMultipartPartIdentityBrand]: 'GraphicsMultipartPartIdentity';
};

export interface BoundedByteStream {
	readonly body: ReadableStream<Uint8Array>;
	readonly byteLength: number;
	readonly maximumByteLength: number;
}

export interface GraphicsObjectMetadata {
	identity: GraphicsObjectIdentity;
	byteLength: number;
	contentType?: string;
	customMetadata: Readonly<Record<string, string>>;
	uploadedAt: Date;
}

export interface CreateImmutableGraphicsObjectInput {
	identity: GraphicsObjectIdentity;
	bytes: BoundedByteStream;
	metadata?: {
		contentType?: string;
		custom?: Readonly<Record<string, string>>;
	};
}

export interface GraphicsMultipartUpload {
	identity: GraphicsObjectIdentity;
	uploadId: GraphicsMultipartUploadIdentity;
}

export interface GraphicsMultipartPart {
	partNumber: number;
	partIdentity: GraphicsMultipartPartIdentity;
	byteLength: number;
}

export type BeginGraphicsMultipartOutcome = {
	outcome: 'started';
	upload: GraphicsMultipartUpload;
} | GraphicsObjectStoreUnavailable;

export type ResumeGraphicsMultipartOutcome
	= | { outcome: 'resumed'; upload: GraphicsMultipartUpload }
		| GraphicsObjectStoreUnavailable;

export type UploadGraphicsMultipartPartOutcome
	= | { outcome: 'uploaded'; part: GraphicsMultipartPart }
		| GraphicsObjectStoreUnavailable;

export type CompleteGraphicsMultipartOutcome
	= | { outcome: 'created'; object: GraphicsObjectMetadata }
		| GraphicsObjectStoreUnavailable;

export type DeleteGraphicsObjectOutcome
	= | { outcome: 'deleted' }
		| { outcome: 'missing' }
		| GraphicsObjectStoreUnavailable;

export type CreateImmutableGraphicsObjectOutcome
	= | { outcome: 'created'; object: GraphicsObjectMetadata }
		| { outcome: 'already-exists'; object: GraphicsObjectMetadata }
		| GraphicsObjectStoreUnavailable;

export type GraphicsObjectMetadataOutcome
	= | { outcome: 'available'; object: GraphicsObjectMetadata }
		| { outcome: 'missing' }
		| GraphicsObjectStoreUnavailable;

export interface GraphicsObjectRange {
	offset: number;
	length: number;
	completeLength: number;
}

export interface GraphicsObjectStoreUnavailable {
	outcome: 'unavailable';
	reason: {
		code: 'object-unavailable' | 'transient-object-store-failure';
		retryable: true;
	};
}

export type ReadGraphicsObjectOutcome
	= | {
		outcome: 'available';
		object: GraphicsObjectMetadata;
		body: ReadableStream<Uint8Array>;
		range: GraphicsObjectRange;
	}
	| { outcome: 'missing' }
	| GraphicsObjectStoreUnavailable;

export interface GraphicsObjectStore {
	checkHealth: () => Promise<{ outcome: 'healthy' } | GraphicsObjectStoreUnavailable>;
	createImmutable: (input: CreateImmutableGraphicsObjectInput) => Promise<CreateImmutableGraphicsObjectOutcome>;
	readMetadata: (identity: GraphicsObjectIdentity) => Promise<GraphicsObjectMetadataOutcome>;
	read: (identity: GraphicsObjectIdentity, range?: { offset: number; length: number }) => Promise<ReadGraphicsObjectOutcome>;
	beginMultipart: (input: Pick<CreateImmutableGraphicsObjectInput, 'identity' | 'metadata'>) => Promise<BeginGraphicsMultipartOutcome>;
	resumeMultipart: (identity: GraphicsObjectIdentity, uploadId: GraphicsMultipartUploadIdentity) => Promise<ResumeGraphicsMultipartOutcome>;
	uploadPart: (input: {
		upload: GraphicsMultipartUpload;
		partNumber: number;
		bytes: BoundedByteStream;
	}) => Promise<UploadGraphicsMultipartPartOutcome>;
	completeMultipart: (input: {
		upload: GraphicsMultipartUpload;
		parts: readonly GraphicsMultipartPart[];
	}) => Promise<CompleteGraphicsMultipartOutcome>;
	abortMultipart: (upload: GraphicsMultipartUpload) => Promise<{ outcome: 'aborted' } | GraphicsObjectStoreUnavailable>;
	delete: (identity: GraphicsObjectIdentity) => Promise<DeleteGraphicsObjectOutcome>;
}

export type GraphicsObjectStoreOperation
	= | 'health'
		| 'create'
		| 'metadata'
		| 'read'
		| 'multipart-start'
		| 'multipart-resume'
		| 'multipart-upload-part'
		| 'multipart-complete'
		| 'multipart-abort'
		| 'delete';

export interface InMemoryGraphicsObjectStore extends GraphicsObjectStore {
	markUnavailable: (identity: GraphicsObjectIdentity) => void;
	restore: (identity: GraphicsObjectIdentity) => void;
	injectTransientFailure: (operation: GraphicsObjectStoreOperation, count?: number) => void;
}

interface StoredObject {
	bytes: Uint8Array;
	metadata: GraphicsObjectMetadata;
}

interface StoredMultipartUpload {
	upload: GraphicsMultipartUpload;
	metadata?: CreateImmutableGraphicsObjectInput['metadata'];
	parts: Map<number, { bytes: Uint8Array; part: GraphicsMultipartPart }>;
}

class GraphicsObjectInputError extends Error {}

export function graphicsObjectIdentity(value: string): GraphicsObjectIdentity {
	if (value.length === 0)
		throw new Error('A graphics object identity cannot be empty');
	return value as GraphicsObjectIdentity;
}

export function createBoundedByteStream(
	input: Uint8Array | ReadableStream<Uint8Array>,
	options: { byteLength: number; maximumByteLength: number },
): BoundedByteStream {
	if (!Number.isSafeInteger(options.byteLength) || options.byteLength < 0)
		throw new GraphicsObjectInputError('Byte length must be a non-negative safe integer');
	if (!Number.isSafeInteger(options.maximumByteLength) || options.maximumByteLength < 0)
		throw new GraphicsObjectInputError('Maximum byte length must be a non-negative safe integer');
	if (options.byteLength > options.maximumByteLength)
		throw new GraphicsObjectInputError('Byte stream exceeds its maximum byte length');

	const source = input instanceof Uint8Array
		? new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(input);
					controller.close();
				},
			})
		: input;

	let observedByteLength = 0;
	const boundedBody = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			observedByteLength += chunk.byteLength;
			if (observedByteLength > options.maximumByteLength)
				throw new GraphicsObjectInputError('Byte stream exceeded its maximum byte length');
			controller.enqueue(chunk);
		},
		flush() {
			if (observedByteLength !== options.byteLength)
				throw new GraphicsObjectInputError(`Byte stream length mismatch: expected ${options.byteLength}, received ${observedByteLength}`);
		},
	}));

	return {
		body: boundedBody,
		byteLength: options.byteLength,
		maximumByteLength: options.maximumByteLength,
	};
}

function rethrowGraphicsObjectInputError(error: unknown): void {
	let current = error;
	while (current instanceof Error) {
		if (current instanceof GraphicsObjectInputError)
			throw current;
		current = current.cause;
	}
}

function validateRequestedRange(range: { offset: number; length: number } | undefined): void {
	if (!range)
		return;
	if (!Number.isSafeInteger(range.offset) || range.offset < 0)
		throw new GraphicsObjectInputError('Range offset must be a non-negative safe integer');
	if (!Number.isSafeInteger(range.length) || range.length <= 0)
		throw new GraphicsObjectInputError('Range length must be a positive safe integer');
}

function validateMultipartPartNumber(partNumber: number): void {
	if (!Number.isSafeInteger(partNumber) || partNumber <= 0)
		throw new GraphicsObjectInputError('Multipart part number must be a positive safe integer');
}

function unavailableObjectStoreOutcome(): GraphicsObjectStoreUnavailable {
	return {
		outcome: 'unavailable',
		reason: { code: 'transient-object-store-failure', retryable: true },
	};
}

function mapR2Object(object: R2Object): GraphicsObjectMetadata {
	return {
		identity: graphicsObjectIdentity(object.key),
		byteLength: object.size,
		contentType: object.httpMetadata?.contentType,
		customMetadata: { ...object.customMetadata },
		uploadedAt: object.uploaded,
	};
}

/**
 * Production adapter for a private Cloudflare R2 binding.
 *
 * R2 identities, upload IDs, ETags, and conditional APIs terminate here. The
 * Graphics Asset Library and its callers receive only provider-neutral values.
 */
export function createR2GraphicsObjectStore(bucket: R2Bucket): GraphicsObjectStore {
	return {
		async checkHealth() {
			try {
				await bucket.head('.stream-keepr-health');
				return { outcome: 'healthy' };
			}
			catch (error) {
				rethrowGraphicsObjectInputError(error);
				return unavailableObjectStoreOutcome();
			}
		},
		async createImmutable(input) {
			try {
				const object = await bucket.put(input.identity, input.bytes.body, {
					onlyIf: new Headers({ 'if-none-match': '*' }),
					httpMetadata: input.metadata?.contentType
						? { contentType: input.metadata.contentType }
						: undefined,
					customMetadata: input.metadata?.custom
						? { ...input.metadata.custom }
						: undefined,
				});
				if (object)
					return { outcome: 'created', object: mapR2Object(object) };

				const existing = await bucket.head(input.identity);
				return existing
					? { outcome: 'already-exists', object: mapR2Object(existing) }
					: unavailableObjectStoreOutcome();
			}
			catch (error) {
				rethrowGraphicsObjectInputError(error);
				return unavailableObjectStoreOutcome();
			}
		},
		async readMetadata(identity) {
			try {
				const object = await bucket.head(identity);
				return object
					? { outcome: 'available', object: mapR2Object(object) }
					: { outcome: 'missing' };
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async read(identity, requestedRange) {
			validateRequestedRange(requestedRange);
			try {
				const object = await bucket.get(identity, requestedRange ? { range: requestedRange } : undefined);
				if (!object)
					return { outcome: 'missing' };

				const offset = object.range && 'offset' in object.range
					? object.range.offset ?? 0
					: requestedRange?.offset ?? 0;
				const length = object.range && 'length' in object.range
					? object.range.length ?? object.size
					: requestedRange?.length ?? object.size;
				return {
					outcome: 'available',
					object: mapR2Object(object),
					body: object.body,
					range: {
						offset,
						length,
						completeLength: object.size,
					},
				};
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async beginMultipart(input) {
			try {
				const upload = await bucket.createMultipartUpload(input.identity, {
					httpMetadata: input.metadata?.contentType
						? { contentType: input.metadata.contentType }
						: undefined,
					customMetadata: input.metadata?.custom
						? { ...input.metadata.custom }
						: undefined,
				});
				return {
					outcome: 'started',
					upload: {
						identity: input.identity,
						uploadId: upload.uploadId as GraphicsMultipartUploadIdentity,
					},
				};
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async resumeMultipart(identity, uploadId) {
			try {
				const upload = bucket.resumeMultipartUpload(identity, uploadId);
				return {
					outcome: 'resumed',
					upload: {
						identity,
						uploadId: upload.uploadId as GraphicsMultipartUploadIdentity,
					},
				};
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async uploadPart(input) {
			validateMultipartPartNumber(input.partNumber);
			try {
				const upload = bucket.resumeMultipartUpload(input.upload.identity, input.upload.uploadId);
				const part = await upload.uploadPart(input.partNumber, input.bytes.body);
				return {
					outcome: 'uploaded',
					part: {
						partNumber: part.partNumber,
						partIdentity: part.etag as GraphicsMultipartPartIdentity,
						byteLength: input.bytes.byteLength,
					},
				};
			}
			catch (error) {
				rethrowGraphicsObjectInputError(error);
				return unavailableObjectStoreOutcome();
			}
		},
		async completeMultipart(input) {
			for (const part of input.parts)
				validateMultipartPartNumber(part.partNumber);
			try {
				const upload = bucket.resumeMultipartUpload(input.upload.identity, input.upload.uploadId);
				const object = await upload.complete(input.parts.map(part => ({
					partNumber: part.partNumber,
					etag: part.partIdentity,
				})));
				return { outcome: 'created', object: mapR2Object(object) };
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async abortMultipart(uploadIdentity) {
			try {
				const upload = bucket.resumeMultipartUpload(uploadIdentity.identity, uploadIdentity.uploadId);
				await upload.abort();
				return { outcome: 'aborted' };
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async delete(identity) {
			try {
				const existing = await bucket.head(identity);
				if (!existing)
					return { outcome: 'missing' };
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Cloudflare R2 binding, not a Drizzle table.
				await bucket.delete(identity);
				return { outcome: 'deleted' };
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
	};
}

async function consumeBoundedByteStream(bytes: BoundedByteStream): Promise<Uint8Array> {
	const reader = bytes.body.getReader();
	const chunks: Uint8Array[] = [];
	let observedByteLength = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done)
			break;
		observedByteLength += value.byteLength;
		if (observedByteLength > bytes.maximumByteLength)
			throw new GraphicsObjectInputError('Byte stream exceeded its maximum byte length');
		chunks.push(value);
	}

	if (observedByteLength !== bytes.byteLength)
		throw new GraphicsObjectInputError(`Byte stream length mismatch: expected ${bytes.byteLength}, received ${observedByteLength}`);

	const result = new Uint8Array(observedByteLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function readableBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

export function createInMemoryGraphicsObjectStore(): InMemoryGraphicsObjectStore {
	const objects = new Map<GraphicsObjectIdentity, StoredObject>();
	const multipartUploads = new Map<GraphicsMultipartUploadIdentity, StoredMultipartUpload>();
	const unavailableObjects = new Set<GraphicsObjectIdentity>();
	const transientFailures = new Map<GraphicsObjectStoreOperation, number>();

	function shouldFailTransiently(operation: GraphicsObjectStoreOperation) {
		const failuresRemaining = transientFailures.get(operation) ?? 0;
		if (failuresRemaining === 0)
			return false;
		transientFailures.set(operation, failuresRemaining - 1);
		return true;
	}

	return {
		async checkHealth() {
			return shouldFailTransiently('health')
				? {
						outcome: 'unavailable',
						reason: { code: 'transient-object-store-failure', retryable: true },
					}
				: { outcome: 'healthy' };
		},
		async createImmutable(input) {
			if (shouldFailTransiently('create'))
				return unavailableObjectStoreOutcome();
			const existing = objects.get(input.identity);
			if (existing) {
				return {
					outcome: 'already-exists',
					object: existing.metadata,
				};
			}

			const bytes = await consumeBoundedByteStream(input.bytes);
			const metadata: GraphicsObjectMetadata = {
				identity: input.identity,
				byteLength: bytes.byteLength,
				contentType: input.metadata?.contentType,
				customMetadata: { ...input.metadata?.custom },
				uploadedAt: new Date(),
			};
			objects.set(input.identity, { bytes, metadata });
			return { outcome: 'created', object: metadata };
		},
		async readMetadata(identity) {
			if (shouldFailTransiently('metadata'))
				return unavailableObjectStoreOutcome();
			const object = objects.get(identity);
			if (!object)
				return { outcome: 'missing' };
			if (unavailableObjects.has(identity)) {
				return {
					outcome: 'unavailable',
					reason: { code: 'object-unavailable', retryable: true },
				};
			}
			return { outcome: 'available', object: object.metadata };
		},
		async read(identity, requestedRange) {
			validateRequestedRange(requestedRange);
			if (shouldFailTransiently('read')) {
				return {
					outcome: 'unavailable',
					reason: { code: 'transient-object-store-failure', retryable: true },
				};
			}
			const stored = objects.get(identity);
			if (!stored)
				return { outcome: 'missing' };
			if (unavailableObjects.has(identity)) {
				return {
					outcome: 'unavailable',
					reason: { code: 'object-unavailable', retryable: true },
				};
			}

			const offset = requestedRange?.offset ?? 0;
			const length = requestedRange?.length ?? stored.bytes.byteLength;
			if (requestedRange && offset >= stored.bytes.byteLength)
				throw new GraphicsObjectInputError('Range offset must be within the object');
			const availableLength = Math.min(length, stored.bytes.byteLength - offset);

			return {
				outcome: 'available',
				object: stored.metadata,
				body: readableBytes(stored.bytes.slice(offset, offset + availableLength)),
				range: {
					offset,
					length: availableLength,
					completeLength: stored.bytes.byteLength,
				},
			};
		},
		async beginMultipart(input) {
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
			return { outcome: 'started', upload };
		},
		async resumeMultipart(identity, uploadId) {
			if (shouldFailTransiently('multipart-resume'))
				return unavailableObjectStoreOutcome();
			const stored = multipartUploads.get(uploadId);
			return stored?.upload.identity === identity
				? { outcome: 'resumed', upload: stored.upload }
				: unavailableObjectStoreOutcome();
		},
		async uploadPart(input) {
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
			return { outcome: 'uploaded', part };
		},
		async completeMultipart(input) {
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
			return { outcome: 'created', object: metadata };
		},
		async abortMultipart(upload) {
			if (shouldFailTransiently('multipart-abort'))
				return unavailableObjectStoreOutcome();
			const stored = multipartUploads.get(upload.uploadId);
			if (!stored || stored.upload.identity !== upload.identity)
				return unavailableObjectStoreOutcome();
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			multipartUploads.delete(upload.uploadId);
			return { outcome: 'aborted' };
		},
		async delete(identity) {
			if (shouldFailTransiently('delete'))
				return unavailableObjectStoreOutcome();
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Set, not a Drizzle table.
			unavailableObjects.delete(identity);
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Map, not a Drizzle table.
			return objects.delete(identity)
				? { outcome: 'deleted' }
				: { outcome: 'missing' };
		},
		markUnavailable(identity) {
			if (!objects.has(identity))
				throw new Error('Cannot mark a missing graphics object unavailable');
			unavailableObjects.add(identity);
		},
		restore(identity) {
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- In-memory Set, not a Drizzle table.
			unavailableObjects.delete(identity);
		},
		injectTransientFailure(operation, count = 1) {
			if (!Number.isSafeInteger(count) || count <= 0)
				throw new Error('Transient failure count must be a positive safe integer');
			transientFailures.set(operation, (transientFailures.get(operation) ?? 0) + count);
		},
	};
}
