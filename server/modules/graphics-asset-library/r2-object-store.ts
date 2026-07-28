import type {
	CreateImmutableGraphicsObjectInput,
	CreateImmutableGraphicsObjectOutcome,
	GraphicsCanonicalObjectStore,
	GraphicsMultipartPartIdentity,
	GraphicsMultipartUploadIdentity,
	GraphicsObjectIdentity,
	GraphicsObjectMetadata,
	GraphicsStagingObjectStore,
} from './object-store';
import {
	consumeBoundedByteStream,
	graphicsObjectIdentity,
	rethrowGraphicsObjectInputError,
	unavailableObjectStoreOutcome,
	validateMultipartPartNumber,
	validateRequestedRange,
} from './object-store';

function mapR2Object(object: R2Object): GraphicsObjectMetadata {
	return {
		identity: graphicsObjectIdentity(object.key),
		byteLength: object.size,
		contentType: object.httpMetadata?.contentType,
		customMetadata: { ...object.customMetadata },
		uploadedAt: object.uploaded,
	};
}

function createR2ObjectStoreAccess(bucket: R2Bucket) {
	return {
		async checkHealth() {
			try {
				await bucket.head('.stream-keepr-health');
				return { outcome: 'healthy' as const };
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async readMetadata(identity: GraphicsObjectIdentity) {
			try {
				const object = await bucket.head(identity);
				return object
					? { outcome: 'available' as const, object: mapR2Object(object) }
					: { outcome: 'missing' as const };
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
		async read(identity: GraphicsObjectIdentity, requestedRange?: { offset: number; length: number }) {
			validateRequestedRange(requestedRange);
			try {
				const object = await bucket.get(identity, requestedRange ? { range: requestedRange } : undefined);
				if (!object)
					return { outcome: 'missing' as const };

				const offset = object.range && 'offset' in object.range
					? object.range.offset ?? 0
					: requestedRange?.offset ?? 0;
				const length = object.range && 'length' in object.range
					? object.range.length ?? object.size
					: requestedRange?.length ?? object.size;
				return {
					outcome: 'available' as const,
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
		async delete(identity: GraphicsObjectIdentity) {
			try {
				const existing = await bucket.head(identity);
				if (!existing)
					return { outcome: 'missing' as const };
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Cloudflare R2 binding, not a Drizzle table.
				await bucket.delete(identity);
				return { outcome: 'deleted' as const };
			}
			catch {
				return unavailableObjectStoreOutcome();
			}
		},
	};
}

async function createImmutable(
	bucket: R2Bucket,
	input: CreateImmutableGraphicsObjectInput,
): Promise<CreateImmutableGraphicsObjectOutcome> {
	try {
		// Production Workers expose FixedLengthStream, preserving a bounded
		// streaming write and its authoritative length for R2. Nuxt's local
		// Miniflare binding is a Node-side proxy without that runtime primitive,
		// so the already-bounded local fallback supplies a fixed-length value.
		const fixedLength = typeof FixedLengthStream === 'undefined'
			? undefined
			: new FixedLengthStream(input.bytes.byteLength);
		const transfer = fixedLength
			? input.bytes.body.pipeTo(fixedLength.writable)
			: undefined;
		const value = fixedLength
			? fixedLength.readable
			: await consumeBoundedByteStream(input.bytes);
		let object: R2Object | null;
		try {
			object = await bucket.put(input.identity, value, {
				onlyIf: { etagDoesNotMatch: '*' },
				httpMetadata: input.metadata?.contentType
					? { contentType: input.metadata.contentType }
					: undefined,
				customMetadata: input.metadata?.custom
					? { ...input.metadata.custom }
					: undefined,
			});
			await transfer;
		}
		catch (error) {
			await transfer?.catch(() => undefined);
			throw error;
		}
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
}

/**
 * Private canonical R2 binding. Multipart completion is intentionally absent
 * from the returned object so digest-owned content cannot be overwritten.
 */
export function createR2CanonicalGraphicsObjectStore(bucket: R2Bucket): GraphicsCanonicalObjectStore {
	return {
		...createR2ObjectStoreAccess(bucket),
		createImmutable: input => createImmutable(bucket, input),
	};
}

/**
 * Private staging R2 binding. Multipart completion may replace an
 * operation-owned staging identity before validation and publication.
 */
export function createR2StagingGraphicsObjectStore(bucket: R2Bucket): GraphicsStagingObjectStore {
	return {
		...createR2ObjectStoreAccess(bucket),
		createImmutable: input => createImmutable(bucket, input),
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
				const fixedLength = typeof FixedLengthStream === 'undefined'
					? undefined
					: new FixedLengthStream(input.bytes.byteLength);
				const transfer = fixedLength
					? input.bytes.body.pipeTo(fixedLength.writable)
					: undefined;
				const partBody = fixedLength
					? fixedLength.readable
					: await consumeBoundedByteStream(input.bytes);
				let part: R2UploadedPart;
				try {
					part = await upload.uploadPart(input.partNumber, partBody);
					await transfer;
				}
				catch (error) {
					await transfer?.catch(() => undefined);
					throw error;
				}
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
				const object = await upload.complete(input.parts
					.toSorted((left, right) => left.partNumber - right.partNumber)
					.map(part => ({
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
	};
}
