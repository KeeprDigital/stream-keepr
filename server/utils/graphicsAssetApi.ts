import type { H3Event } from 'h3';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library';
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
		const statusCode = ({
			'invalid-ingestion-input': 400,
			'ingestion-operation-not-found': 404,
			'ingestion-operation-not-uploadable': 409,
			'staging-capacity-exhausted': 507,
			'canonical-capacity-exhausted': 507,
			'graphics-asset-library-unavailable': 503,
		} as const)[error.code];
		if (statusCode === 503 && event)
			setResponseHeader(event, 'retry-after', 5);
		throw createError({
			statusCode,
			statusMessage: statusCode === 404
				? 'Not Found'
				: statusCode === 409
					? 'Conflict'
					: statusCode === 507
						? 'Insufficient Storage'
						: statusCode === 503
							? 'Service Unavailable'
							: 'Bad Request',
			message: error.message,
			data: error.capacity,
			cause: error,
		});
	}
	throw error;
}
