import { graphicsCapacityErrorDescriptor } from '~~/server/modules/graphics-asset-library/errors';
import { StateConflictError } from './errors';

export interface MappableNitroError {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
	unhandled?: boolean;
}

export function mapPublicNitroError(error: MappableNitroError): void {
	const cause = error.cause;
	const graphicsCapacityError = graphicsCapacityErrorDescriptor(cause);
	let hasMappedPublicServerMessage = false;
	let mappedOperationalError = false;

	if (cause instanceof StateConflictError) {
		error.statusCode = 409;
		error.statusMessage = 'Conflict';
		error.message = cause.message;
		mappedOperationalError = true;
	}
	else if (graphicsCapacityError) {
		error.statusCode = graphicsCapacityError.statusCode;
		error.statusMessage = graphicsCapacityError.statusMessage;
		error.message = (cause as Error).message;
		hasMappedPublicServerMessage = true;
		mappedOperationalError = true;
	}
	else if (cause instanceof Error && cause.message?.includes('UNIQUE constraint failed')) {
		error.statusCode = 409;
		error.statusMessage = 'Conflict';
		error.message = 'Resource already exists';
		mappedOperationalError = true;
	}
	else if (cause && typeof cause === 'object' && 'name' in cause && (cause as { name: string }).name === 'ZodError') {
		error.statusCode = 400;
		error.statusMessage = 'Validation Error';
		mappedOperationalError = true;
	}
	else if (cause && typeof cause === 'object' && 'code' in cause && (cause as { code: unknown }).code === 'IMPORTED_CARD_LOOKUP_UNAVAILABLE') {
		error.statusCode = 503;
		error.statusMessage = 'Service Unavailable';
		error.message = 'Card data provider is temporarily unavailable. Existing deck data was preserved; retry the sync.';
		hasMappedPublicServerMessage = true;
		mappedOperationalError = true;
	}
	else if (cause && typeof cause === 'object' && 'code' in cause && (cause as { code: unknown }).code === 'MELEE_UPSTREAM_FAILURE') {
		const category = 'category' in cause ? (cause as { category: unknown }).category : null;
		error.statusCode = category === 'timeout' ? 504 : 502;
		error.statusMessage = category === 'timeout' ? 'Gateway Timeout' : 'Bad Gateway';
		error.message = 'Melee.gg is temporarily unavailable. Try again later.';
		hasMappedPublicServerMessage = true;
		mappedOperationalError = true;
	}
	else if (
		cause
		&& typeof cause === 'object'
		&& 'code' in cause
		&& (cause as { code: unknown }).code === 'SCRYFALL_UPSTREAM_FAILURE'
		&& (!('notFound' in cause) || (cause as { notFound: unknown }).notFound !== true)
	) {
		error.statusCode = 502;
		error.statusMessage = 'Bad Gateway';
		error.message = 'Card data provider is temporarily unavailable. Try again later.';
		hasMappedPublicServerMessage = true;
		mappedOperationalError = true;
	}

	// These are classified, expected operational failures. Marking them handled
	// prevents Nitro's fallback logger from emitting a second raw stack/cause
	// after the safe structured record produced by the error plugin.
	if (mappedOperationalError)
		error.unhandled = false;

	// Sanitize every server error, including explicit createError(500) values.
	// A missing cause must not become an escape hatch for internal details.
	if (error.statusCode >= 500 && !hasMappedPublicServerMessage) {
		error.message = 'Internal Server Error';
		error.statusMessage = 'Internal Server Error';
	}
}
