/** Long enough for a store's sentence and its trailing code, short enough for one log line. */
const MAX_STORE_FAILURE_REASON_CHARS = 200;

/**
 * A log line saying why a store this library depends on refused (#633).
 *
 * The library answers every such refusal as `graphics-asset-library-unavailable`
 * and never hands the caller what was caught — the response names which store,
 * and nothing a provider wrote. That left the provider's own account nowhere: a
 * multipart part answered 503 under `pnpm verify`, and neither the body nor the
 * failure log could say whether R2 or D1 refused, or with what. This is where
 * it goes instead, one line per refusal, in the shape `publishFailureFields`
 * gives a refused realtime publish.
 *
 * The fields are named, not copied: an error's name, its code where it has a
 * string or finite one (R2's are numbers, Node's strings), and its message cut
 * short. Total by construction, because every caller is a catch block that is
 * about to answer an outage and must not throw while saying so.
 */
export function logGraphicsStoreFailure(
	message: string,
	context: Record<string, string>,
	error: unknown,
): void {
	try {
		const record = error as { name?: unknown; code?: unknown; message?: unknown } | null | undefined;
		const code = record?.code;
		console.warn(JSON.stringify({
			message,
			...context,
			errorName: error instanceof Error ? error.name : null,
			errorCode: typeof code === 'string' || (typeof code === 'number' && Number.isFinite(code))
				? code
				: null,
			reason: typeof record?.message === 'string'
				? record.message.slice(0, MAX_STORE_FAILURE_REASON_CHARS)
				: null,
		}));
	}
	catch {
		// An unreadable error, or a console that refuses: the outage is still answered.
	}
}
