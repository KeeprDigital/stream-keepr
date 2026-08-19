import { GraphicsAssetLibraryError, graphicsCapacityErrorDescriptor } from '~~/server/modules/graphics-asset-library/errors';
import { meleeKeyringConfigurationFaultSentence } from '~~/server/services/meleeCredentials';
import { STATE_CONFLICT_CODE } from '~~/shared/utils/stateConflict';
import {
	ServiceConfigurationError,
	StateConflictError,
	TemporarilyUnavailableError,
} from './errors';
import { RealtimePublishError } from './realtimePublishFailure';

export interface MappableNitroError {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
	data?: unknown;
	unhandled?: boolean;
}

export function mapPublicNitroError(error: MappableNitroError): void {
	const cause = error.cause;
	const graphicsCapacityError = graphicsCapacityErrorDescriptor(cause);
	const meleeKeyringFaultSentence = meleeKeyringConfigurationFaultSentence(cause);
	let hasMappedPublicServerMessage = false;
	let mappedOperationalError = false;

	if (cause instanceof StateConflictError) {
		error.statusCode = 409;
		error.statusMessage = 'Conflict';
		error.message = cause.message;
		// A lost race is the one 409 a refresh-and-retry can cure, and the client's
		// conflict retry replays a write only when this mark says so — an unmarked
		// 409 is a refusal, surfaced instead of re-run (#381).
		error.data = { code: STATE_CONFLICT_CODE };
		mappedOperationalError = true;
	}
	else if (cause instanceof ServiceConfigurationError) {
		// The one 5xx whose message must survive sanitizing, because it names a
		// setting rather than describing the server's insides. #233: screen
		// creation on a fresh checkout answered a bare 'Internal Server Error'
		// for a missing environment variable.
		error.statusCode = cause.statusCode;
		error.statusMessage = 'Service Unavailable';
		error.message = cause.message;
		hasMappedPublicServerMessage = true;
		mappedOperationalError = true;
	}
	else if (cause instanceof RealtimePublishError) {
		// The realtime service refused a publish this request could not go on
		// without. A Bad Gateway rather than an Internal Server Error because this
		// server's own work succeeded, and a public message for the same reason the
		// branch above has one: it names which dependency failed, and the
		// caller cannot fix what it is not told about. The provider's own account of
		// the refusal stays in the log — see `realtimePublishFailure`.
		error.statusCode = cause.statusCode;
		error.statusMessage = 'Bad Gateway';
		error.message = cause.message;
		hasMappedPublicServerMessage = true;
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
	else if (meleeKeyringFaultSentence !== null) {
		// #347, the #233 judgement one subsystem over: a keyring-configuration
		// fault is an unfinished deployment, and the sentence names the setting an
		// operator must fix. Only the configuration half of the crypto codes maps —
		// see `meleeKeyringConfigurationFaultSentence` for the split. The sentence is this
		// map's rather than the raiser's so the crypto library's own words never
		// reach a response; they stay on the cause, where `errorLogFields` reads
		// the code.
		error.statusCode = 503;
		error.statusMessage = 'Service Unavailable';
		error.message = meleeKeyringFaultSentence;
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
	else if (
		cause instanceof GraphicsAssetLibraryError
		&& cause.code === 'graphics-asset-library-unavailable'
	) {
		// The library says which of its stores it could not reach — the catalogue,
		// the staging byte store, the canonical one — and that is carried rather
		// than replaced, because which store is down is the part an operator acts
		// on and the routes raising it have no other way to say so. Sanitizing it
		// sent them to the logs of a server whose own database may be the thing
		// that is unreachable. #294; the same judgement as #233 and #243.
		//
		// Only this one code. Every other `GraphicsAssetLibraryError` is answered
		// below 500 by `rethrowGraphicsAssetApiError`, except the two capacity
		// codes, which the branch above already has.
		//
		// Twenty-three sites in the library raise this code and every one of them
		// publishes its sentence through here. Twenty write a literal naming a store
		// or an interrupted operation. Three interpolate, and what they interpolate
		// is the point: a part number, a caller-supplied literal, and the origin the
		// author asked for — never what was caught. `remote-source.ts` shows the
		// rule being kept in the one place it would be easiest to break, returning
		// '<origin> could not be reached right now.' from inside a bare `catch`.
		// A site that published a caught exception instead would hand a provider's
		// own words to every caller; those belong in `cause`, which no response body
		// carries. (Counted for #321: a note here used to say three throw sites.)
		error.statusCode = 503;
		error.statusMessage = 'Service Unavailable';
		error.message = cause.message;
		hasMappedPublicServerMessage = true;
		mappedOperationalError = true;
	}
	else if (cause instanceof TemporarilyUnavailableError) {
		// The shared classification, and the one branch here that is not about a
		// particular subsystem: seven sites each wrote an operator a sentence about
		// something momentarily out of reach — Graphic Asset content whole and
		// ranged, thumbnails, staged bytes, Screen Output delivery, a capability
		// session, a Template Package export — and every one of those sentences was
		// overwritten below until #321. They differ only in what they name, so they
		// share a class rather than earning seven, and the message carried here is
		// the raiser's.
		error.statusCode = cause.statusCode;
		error.statusMessage = 'Service Unavailable';
		error.message = cause.message;
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
		// `data` rides the response body untouched by the message rewrite above,
		// so a `createError(5xx, { data })` used to hand callers whatever a throw
		// site attached while its sentence was being sanitized — #347 found a
		// crypto code travelling that way. An unmapped 5xx publishes nothing; the
		// two deliberate 5xx `data` payloads (the Template Package export report,
		// the graphics capacity descriptor) ride mapped errors and never get here.
		delete error.data;
	}
}
