/**
 * What a refused realtime publish is allowed to say, and what it becomes.
 *
 * Two answers to one failure, kept together because they are the same judgement
 * read by different audiences. `publishFailureFields` is what the log may carry
 * — the provider's own account, bounded and named field by field. The error
 * class is what a caller that cannot swallow the failure raises instead: this
 * server's own classification, carrying none of the provider's text.
 *
 * It lives apart from `ably.ts` so a caller can build the log fields without
 * importing the SDK, and so a suite that mocks the Ably module still exercises
 * the real extraction. #253 built the fields; #264 added the classification and
 * moved both here.
 */

/**
 * How much of a failure's own message the log will carry.
 *
 * The provider's message is usually a short phrase ("No application found"), but
 * the transport's fallback for a response it cannot decode as an Ably error is
 * `'Error response received from server: ' + status + ' body was: ' + body` — so
 * an intermediary answering with an HTML page would otherwise put the whole page
 * in a log line. Bounded rather than dropped: the phrase is the diagnosis.
 */
export const MAX_PUBLISH_FAILURE_REASON_CHARS = 200;

// The finiteness half of this guard is belt-and-braces: the transport can build
// a code of `NaN` from an absent `x-ably-errorcode` header, and `JSON.stringify`
// would render that as null anyway. It is here so the declared `number | null`
// is true of the value and not merely of how this one caller serialises it.
function finiteNumberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What a failed publish is allowed to say about why it failed.
 *
 * The provider throws `ErrorInfo`, which carries `statusCode`, `code` and
 * `message` (ably 2.25.0, ably.d.ts) — a rejected key arrives as 404 / 40400
 * "No application found", the server-side witness of the failure #242 had to
 * diagnose from the client. #253: the log used to discard all three, so a
 * revoked or fabricated key spent an outbound request per Screen mutation and
 * said nothing about it.
 *
 * The fields are named, not copied. `ErrorInfo` also carries `href`, `detail`
 * and `cause`, which is the request metadata the previous comment here was
 * right to keep out; none of them is read. Nothing named can carry the API key:
 * it reaches the provider in an Authorization header, and the SDK's own
 * key-shaped errors ("No key specified", "Invalid key specified: the key has no
 * colon-separated secret") interpolate nothing into their message.
 *
 * Total by construction. `code` and `statusCode` are optional and nullable on
 * the SDK's `PartialErrorInfo`, and the transport can build a code of `NaN` from
 * an absent `x-ably-errorcode` header, so both are validated rather than
 * trusted; a throw that is not an Error, or one whose properties refuse to be
 * read, yields nulls. The caller is a catch block that must not itself throw —
 * a failure here would turn a deliberately swallowed publish into a 500 on a
 * route whose write has already committed.
 */
export function publishFailureFields(error: unknown) {
	try {
		const info = error as { statusCode?: unknown; code?: unknown; message?: unknown } | null | undefined;
		return {
			statusCode: finiteNumberOrNull(info?.statusCode),
			errorCode: finiteNumberOrNull(info?.code),
			errorName: error instanceof Error ? error.name : null,
			reason: typeof info?.message === 'string'
				? info.message.slice(0, MAX_PUBLISH_FAILURE_REASON_CHARS)
				: null,
		};
	}
	catch {
		return { statusCode: null, errorCode: null, errorName: null, reason: null };
	}
}

/**
 * The sentence a caller gets when the realtime service refused the publish.
 *
 * Fixed text, and deliberately incurious: the provider's own account is in the
 * log line beside it, and a response body is the wrong place for text this
 * server did not write. `test/integration/realtimeDiagnosis.ts` matches on this
 * exact string to tell a refused publish from the route's own answers — that
 * file imports nothing by design, so the string is a literal on both sides and
 * `realtimeDiagnosis.test.ts` pins the two together through the real mapping.
 */
export const REALTIME_PUBLISH_FAILED_MESSAGE = 'Realtime publish failed';

/**
 * A publish the realtime service refused, as this server's own failure.
 *
 * The class exists because of what h3 does with a bare throw: `createError`
 * adopts `statusCode` from any thrown object, so propagating Ably's `ErrorInfo`
 * made its 404 the *route's* 404 — the same answer the Screen-command route
 * gives for a Screen that does not exist, and the mechanism behind #242's
 * `expected 404 to be 200` under a fabricated key. Two failures with different
 * owners were arriving indistinguishable, and the caller was being told to check
 * its identifiers when the thing to check was the deployment's key.
 *
 * 502 rather than 500: the request was well-formed and this server's own work
 * succeeded — what failed is a service it depends on, which is what a Bad
 * Gateway says. Not swallowed, because the Screen-command route's 200 means the
 * command was delivered and nothing else (#242, recorded deliberately).
 *
 * `code` is the provider's numeric refusal code, carried so the request's own
 * log line names *which* refusal it was — Ably's 40400 for a key whose
 * application does not exist. It is read by `errorLogFields` and never
 * serialised into a response.
 */
export class RealtimePublishError extends Error {
	statusCode = 502;
	readonly code: number | null;

	constructor(cause: unknown) {
		super(REALTIME_PUBLISH_FAILED_MESSAGE, { cause });
		this.name = 'RealtimePublishError';
		this.code = publishFailureFields(cause).errorCode;
	}
}
