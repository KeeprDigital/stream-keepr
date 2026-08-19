/** The parts of a Nitro error the failure log reads. */
export interface LoggedNitroError {
	name: string;
	statusCode: number;
	cause?: unknown;
	unhandled?: boolean;
}

/**
 * A provider's own identifier for a refusal, as a log line may carry it.
 *
 * Both types, because both arrive. Node's convention is a string ('ENOENT'), and
 * the guard this replaces accepted only those — but Ably's `ErrorInfo.code` is a
 * number, 40400 for a key whose application does not exist, so the one field that
 * could name a provider refusal logged `null` for exactly the failure it exists
 * to name (#264). A rejected key then spent an outbound request per Screen
 * mutation with nothing in the log to say why.
 *
 * Finiteness mirrors the guard #253 put on the same value in the publish log: the
 * Ably transport derives `Number(headers['x-ably-errorcode'])` and hands over
 * `NaN` for a response carrying no Ably error body. `JSON.stringify` would render
 * that as null anyway; the check is what makes the declared type true of the
 * value rather than true of one serialisation. Nothing is coerced — a code that
 * is neither a string nor a number is absent, not `Number(code)`.
 */
function errorCodeOf(code: unknown): string | number | null {
	if (typeof code === 'string')
		return code;

	return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

/**
 * How far down a cause chain the code search reaches. Deep enough for every
 * wrapping this codebase does (a route's classified error around a subsystem
 * class around a store exception is three), and a bound at all so a cyclic
 * cause terminates.
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * The nearest valid code in the cause chain (#323).
 *
 * Nearest, not deepest: a domain error's own code is the classification, and a
 * store code beneath it is only the fallback for levels that classify nothing.
 * Before this walk the read stopped at one level, so a class like
 * `TemporarilyUnavailableError` — which names the failure but carries no code —
 * logged `errorCode: null` over the store exception whose code said why the store
 * refused.
 */
function nearestCauseCode(cause: unknown): string | number | null {
	for (
		let record = cause, depth = 0;
		record && typeof record === 'object' && depth < MAX_CAUSE_DEPTH;
		record = (record as { cause?: unknown }).cause, depth += 1
	) {
		const code = errorCodeOf((record as { code?: unknown }).code);
		if (code !== null)
			return code;
	}
	return null;
}

/**
 * The structured record of a failed request.
 *
 * Separate from the plugin that emits it so it can be exercised directly: what a
 * failure log says is the only account anybody gets of a production refusal, and
 * a field that silently reports `null` is worse than an absent one.
 *
 * The name comes from the nearest cause, so the line names the failure class;
 * the code may come from deeper, so the same line still carries the underlying
 * refusal's identifier when the class declares none.
 */
export function errorLogFields(error: LoggedNitroError, path: string | undefined) {
	const cause = error.cause;
	const causeRecord = cause && typeof cause === 'object'
		? cause as { name?: unknown }
		: null;
	return {
		message: 'api_request_failed',
		path: path ?? null,
		statusCode: error.statusCode,
		errorName: typeof causeRecord?.name === 'string' ? causeRecord.name : error.name,
		errorCode: nearestCauseCode(cause),
		unhandled: error.unhandled ?? false,
	};
}
