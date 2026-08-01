import type { H3Event } from 'h3';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library';
import { graphicsCapacityErrorDescriptor } from '~~/server/modules/graphics-asset-library/errors';
import { GraphicsObjectInputError } from '~~/server/modules/graphics-asset-library/object-store';
import { optionalGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

/**
 * Who the Evidence Ledger records for a Graphics Administrator's action.
 *
 * Administrator authority comes from the installation's shared admin token,
 * which names nobody. When the same caller also carries a graphics author
 * session — an operator working the cockpit in a browser always does — that
 * session is the only identity available and is recorded. Otherwise the ledger
 * says an administrator acted and declines to invent a name for them, which is
 * the honest entry: the previous client-supplied header let any holder of the
 * admin token write any name it liked into the installation's audit trail.
 */
export async function graphicsAdministratorActor(event: H3Event): Promise<string> {
	return await optionalGraphicsAuthorSession(event) ?? 'graphics-administrator';
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
