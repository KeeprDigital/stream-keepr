/**
 * The realtime provider's error shape, as four suites need to raise it.
 *
 * From the installed SDK rather than memory: `ErrorInfo extends Error` with
 * `code`, `statusCode` and `message` (node_modules/ably/ably.d.ts:4092-4104,
 * ably 2.25.0). It does not assign `name`, so a genuine `ErrorInfo` reports the
 * inherited `'Error'` — which is why `errorName` alone could never carry this
 * diagnosis, and why the numeric `code` #264 restored is the field that does.
 *
 * `code` is typed `unknown` because the shapes worth testing are the ones the
 * SDK can actually build and the declared type disallows: the transport derives
 * `Number(headers['x-ably-errorcode'])` and hands over `NaN` for a response
 * carrying no Ably error body.
 */
export class ErrorInfoShaped extends Error {
	href?: string;
	detail?: Record<string, string>;
	constructor(message: string, readonly code: unknown, readonly statusCode: number) {
		super(message);
	}
}

/**
 * A key Ably will not accept: 404 / 40400 "No application found".
 *
 * The failure the whole legibility cluster is built around — #242 diagnosed it
 * from the client, #253 put it in the publish log, #264 stopped it wearing the
 * Screen-command route's own 404.
 */
export function providerRefusal(): ErrorInfoShaped {
	return new ErrorInfoShaped('No application found', 40400, 404);
}
