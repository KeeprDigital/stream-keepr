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
 * The structured record of a failed request.
 *
 * Separate from the plugin that emits it so it can be exercised directly: what a
 * failure log says is the only account anybody gets of a production refusal, and
 * a field that silently reports `null` is worse than an absent one.
 */
export function errorLogFields(error: LoggedNitroError, path: string | undefined) {
	const cause = error.cause;
	const causeRecord = cause && typeof cause === 'object'
		? cause as { name?: unknown; code?: unknown }
		: null;
	return {
		message: 'api_request_failed',
		path: path ?? null,
		statusCode: error.statusCode,
		errorName: typeof causeRecord?.name === 'string' ? causeRecord.name : error.name,
		errorCode: errorCodeOf(causeRecord?.code),
		unhandled: error.unhandled ?? false,
	};
}
