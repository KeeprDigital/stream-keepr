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

export interface GraphicsObjectStoreUnavailable {
	outcome: 'unavailable';
	reason: {
		code: 'object-unavailable' | 'transient-object-store-failure';
		retryable: true;
	};
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

export type ReadGraphicsObjectOutcome
	= | {
		outcome: 'available';
		object: GraphicsObjectMetadata;
		body: ReadableStream<Uint8Array>;
		range: GraphicsObjectRange;
	}
	| { outcome: 'missing' }
	| GraphicsObjectStoreUnavailable;

export interface GraphicsObjectStoreHealth {
	checkHealth: () => Promise<{ outcome: 'healthy' } | GraphicsObjectStoreUnavailable>;
}

interface GraphicsObjectStoreAccess extends GraphicsObjectStoreHealth {
	readMetadata: (identity: GraphicsObjectIdentity) => Promise<GraphicsObjectMetadataOutcome>;
	read: (identity: GraphicsObjectIdentity, range?: { offset: number; length: number }) => Promise<ReadGraphicsObjectOutcome>;
	delete: (identity: GraphicsObjectIdentity) => Promise<DeleteGraphicsObjectOutcome>;
}

/**
 * Canonical content is immutable. Its capability deliberately has no multipart
 * completion operation, so callers cannot overwrite a digest-owned identity.
 */
export interface GraphicsCanonicalObjectStore extends GraphicsObjectStoreAccess {
	createImmutable: (input: CreateImmutableGraphicsObjectInput) => Promise<CreateImmutableGraphicsObjectOutcome>;
}

/**
 * Staging content is operation-owned and may be replaced by a completed,
 * resumable multipart transfer before validation and canonical publication.
 */
export interface GraphicsStagingObjectStore extends GraphicsObjectStoreAccess {
	createImmutable: (input: CreateImmutableGraphicsObjectInput) => Promise<CreateImmutableGraphicsObjectOutcome>;
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
}

export type GraphicsCanonicalObjectStoreOperation
	= | 'health'
		| 'create'
		| 'metadata'
		| 'read'
		| 'delete';

export type GraphicsStagingObjectStoreOperation
	= | GraphicsCanonicalObjectStoreOperation
		| 'multipart-start'
		| 'multipart-resume'
		| 'multipart-upload-part'
		| 'multipart-complete'
		| 'multipart-abort';

export interface InMemoryGraphicsObjectStoreControls<
	Operation extends GraphicsStagingObjectStoreOperation,
> {
	markUnavailable: (identity: GraphicsObjectIdentity) => void;
	restore: (identity: GraphicsObjectIdentity) => void;
	injectTransientFailure: (operation: Operation, count?: number) => void;
}

export type InMemoryGraphicsCanonicalObjectStore
	= GraphicsCanonicalObjectStore
		& InMemoryGraphicsObjectStoreControls<GraphicsCanonicalObjectStoreOperation>;

export type InMemoryGraphicsStagingObjectStore
	= GraphicsStagingObjectStore
		& InMemoryGraphicsObjectStoreControls<GraphicsStagingObjectStoreOperation>;

export class GraphicsObjectInputError extends Error {}

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

export function boundedByteStreamWithDeadline(
	bytes: BoundedByteStream,
	timeoutMilliseconds: number,
): BoundedByteStream {
	if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0)
		throw new GraphicsObjectInputError('Byte stream timeout must be a positive safe integer');
	return {
		...bytes,
		body: bytes.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>(),
			{ signal: AbortSignal.timeout(timeoutMilliseconds) },
		),
	};
}

export function rethrowGraphicsObjectInputError(error: unknown): void {
	let current = error;
	while (current instanceof Error) {
		if (current instanceof GraphicsObjectInputError)
			throw current;
		current = current.cause;
	}
}

export function validateRequestedRange(range: { offset: number; length: number } | undefined): void {
	if (!range)
		return;
	if (!Number.isSafeInteger(range.offset) || range.offset < 0)
		throw new GraphicsObjectInputError('Range offset must be a non-negative safe integer');
	if (!Number.isSafeInteger(range.length) || range.length <= 0)
		throw new GraphicsObjectInputError('Range length must be a positive safe integer');
}

export function validateMultipartPartNumber(partNumber: number): void {
	if (!Number.isSafeInteger(partNumber) || partNumber <= 0)
		throw new GraphicsObjectInputError('Multipart part number must be a positive safe integer');
}

export function unavailableObjectStoreOutcome(): GraphicsObjectStoreUnavailable {
	return {
		outcome: 'unavailable',
		reason: { code: 'transient-object-store-failure', retryable: true },
	};
}

export async function consumeBoundedByteStream(bytes: BoundedByteStream): Promise<Uint8Array> {
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

export function readableBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}
