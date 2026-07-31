import type { H3Event } from 'h3';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library';
import { graphicsCapacityErrorDescriptor } from '~~/server/modules/graphics-asset-library/errors';
import { GraphicsObjectInputError } from '~~/server/modules/graphics-asset-library/object-store';

export function graphicsAuthorIdentity(event: H3Event): string {
	const identity = getRequestHeader(event, 'x-graphics-author-id')?.trim();
	return identity || 'local-graphics-author';
}

export function rethrowGraphicsAssetApiError(error: unknown, event?: H3Event): never {
	if (error instanceof GraphicsObjectInputError) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof GraphicsAssetLibraryError) {
		const capacityError = graphicsCapacityErrorDescriptor(error);
		const statusCode = capacityError?.statusCode ?? ({
			'invalid-ingestion-input': 400,
			'ingestion-operation-not-found': 404,
			'graphics-subject-not-found': 404,
			'ingestion-operation-not-uploadable': 409,
			'ingestion-operation-lease-held': 409,
			'graphic-asset-lifecycle-action-not-allowed': 409,
			'staging-capacity-exhausted': 500,
			'canonical-capacity-exhausted': 500,
			'graphics-asset-library-unavailable': 503,
		} as const)[error.code];
		if (statusCode === 503 && event)
			setResponseHeader(event, 'retry-after', 5);
		throw createError({
			statusCode,
			statusMessage: capacityError?.statusMessage ?? (statusCode === 404
				? 'Not Found'
				: statusCode === 409
					? 'Conflict'
					: statusCode === 503
						? 'Service Unavailable'
						: 'Bad Request'),
			message: error.message,
			data: error.capacity,
			cause: error,
		});
	}
	throw error;
}
