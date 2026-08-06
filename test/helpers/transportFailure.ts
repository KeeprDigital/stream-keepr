import { FetchError } from 'ofetch';

/**
 * One failed request as the client actually meets it.
 *
 * Every store action here reaches the server through `$fetch`, so every failure it
 * catches is a `FetchError`: an `Error` whose own `message` is the transport's status
 * line, with the status on `statusCode` and the parsed response body on `data`. A plain
 * object is none of those three things, and the difference is not cosmetic — the real
 * `useAsyncAction` reports a non-`Error` as 'An error occurred', so a suite that rejects
 * with plain objects can assert prose no operator will ever be shown (#241).
 *
 * The same fixture #245's Broadcast Graphics suite builds inline, lifted here because
 * six more stores now read a failure for the sentence the authority wrote (#262).
 *
 * `statusText` is the runtime's own reason phrase; nothing asserts its exact wording.
 * What the suites read from it is that a failure carrying no sentence still surfaces the
 * transport's line.
 */
export function transportFailure(options: {
	status: number;
	/** The reason phrase in the transport line, defaulted per status where it is not the point. */
	statusText?: string;
	/** The parsed response body, as `$fetch` hangs it off `error.data`. */
	body?: unknown;
	/** The request line, as ofetch writes it into the message. */
	request?: string;
}): FetchError {
	const statusText = options.statusText ?? defaultStatusText(options.status);
	const request = options.request ?? `[POST] "/api/…"`;

	return Object.assign(new FetchError(`${request}: ${options.status} ${statusText}`), {
		status: options.status,
		statusCode: options.status,
		statusText,
		statusMessage: statusText,
		data: options.body,
	});
}

function defaultStatusText(status: number): string {
	switch (status) {
		case 400: return 'Bad Request';
		case 403: return 'Forbidden';
		case 404: return 'Not Found';
		case 409: return 'Conflict';
		case 422: return 'Unprocessable Entity';
		case 500: return 'Internal Server Error';
		case 503: return 'Service Unavailable';
		default: return 'Error';
	}
}
