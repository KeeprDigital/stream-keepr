import type {
	GraphicsIngestionOperation,
	GraphicsIngestionPartIdentity,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsMultipartPartIdentity,
	GraphicsMultipartUploadIdentity,
} from './object-store';
import {
	GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS,
	GRAPHICS_MULTIPART_PART_BYTES,
} from '~~/shared/utils/graphicsAssetCompatibility';

export interface GraphicsImageMultipartState {
	version: number;
	uploadId?: GraphicsMultipartUploadIdentity;
	cleanupPending: boolean;
	parts: {
		partNumber: number;
		partIdentity: GraphicsIngestionPartIdentity;
		objectStorePartIdentity?: GraphicsMultipartPartIdentity;
		byteLength: number;
		status: 'uploading' | 'completed' | 'failed';
		claimedAt: string;
		attempts: number;
	}[];
}

export function graphicsIngestionPartIdentity(
	operationId: GraphicsIngestionOperation['id'],
	partNumber: number,
): GraphicsIngestionPartIdentity {
	return `${operationId}:${partNumber}` as GraphicsIngestionPartIdentity;
}

export function graphicsMultipartCompletedByteLength(
	state: GraphicsImageMultipartState,
): number {
	return state.parts
		.filter(part => part.status === 'completed')
		.reduce((total, part) => total + part.byteLength, 0);
}

export function graphicsMultipartTransfer(
	declaredByteLength: number,
	state: GraphicsImageMultipartState,
): NonNullable<GraphicsIngestionOperation['transfer']> {
	return {
		method: 'multipart',
		partByteLength: GRAPHICS_MULTIPART_PART_BYTES,
		maximumConcurrentParts: GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
		maximumPartAttempts: GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS,
		partCount: Math.ceil(declaredByteLength / GRAPHICS_MULTIPART_PART_BYTES),
		cleanupPending: state.cleanupPending ?? false,
		completedParts: state.parts
			.filter(part => part.status === 'completed')
			.map(({ partNumber, partIdentity, byteLength }) => ({
				partNumber,
				partIdentity,
				byteLength,
			}))
			.sort((left, right) => left.partNumber - right.partNumber),
	};
}
