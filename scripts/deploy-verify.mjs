/**
 * Post-deploy liveness probe: `pnpm deploy:verify`, the last step of
 * `pnpm run deploy`. If it fails, stop and roll back (README.md § Deploy day).
 *
 * It reads `GET <base URL>/api/time` and passes only on the Worker's own clock
 * reading: status 200, an `application/json` content type, and a body that
 * parses as `{ serverTime: <positive integer epoch milliseconds> }`. Anything
 * else fails (#617), because each of these has answered "OK" on an origin
 * that was not serving the Worker:
 *
 * - **A redirect is never followed.** A 3xx (a Cloudflare Access login, a
 *   moved route, an `http`→`https` hop) is a failure naming its `Location`;
 *   following it would let a sign-in page stand in for the Worker.
 * - **A 200 that is not the clock reading fails**: an HTML SPA fallback, a
 *   JSON body that does not parse, or JSON of any other shape.
 * - **Any other status fails**, including other 2xx.
 *
 * Only a transport failure (refused, reset, timed out), a 5xx or a 429 is
 * retried, since a freshly promoted Worker can briefly answer those. A
 * definitive wrong answer fails at once.
 *
 * What a pass establishes, and what it does not:
 *
 * - **Established**: some Worker answering the origin runs this app's
 *   `/api/time` handler and reached it without a session (it is on the
 *   session exemption list, `server/utils/apiBoundary.ts`).
 * - **Not established: which release is serving.** `/api/time` carries no
 *   build identity, so the previous Worker passes too. This is liveness only;
 *   it does not prove the new release took traffic.
 * - **Not established: dependency readiness.** The handler reads no binding,
 *   so a pass says nothing about D1, auth (Better Auth, its secrets), R2, KV,
 *   Ably or the silent-video validator. The deployed acceptance gates
 *   (`pnpm accept deployed`) are what exercise those.
 *
 * The base URL defaults to production and is overridable for any explicit
 * target with `STREAM_KEEPR_DEPLOY_HEALTH_URL` (#525 reuses this probe).
 */

import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** The committed production hostname (wrangler.jsonc `routes`). */
const DEFAULT_BASE_URL = 'https://stream.keepr.digital';

/** One try plus three retries, 5 s apart, 15 s each: the budget the pre-#617 curl probe had. */
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export class DeployVerifyFailure extends Error {
	constructor(message, { retryable = false, cause } = {}) {
		super(message, { cause });
		this.name = 'DeployVerifyFailure';
		this.retryable = retryable;
	}
}

function excerpt(text) {
	const flat = text.replace(/\s+/g, ' ').trim();
	return JSON.stringify(flat.length > 120 ? `${flat.slice(0, 120)}…` : flat);
}

/**
 * The probe URL under an explicit target base URL: any http(s) origin, path
 * prefix included. Anything else, a query or fragment among it, is refused
 * before a request, since retrying a typo would only delay the same failure.
 */
function healthUrl(baseUrl) {
	let parsed;
	try {
		parsed = new URL(baseUrl);
	}
	catch {
		parsed = undefined;
	}
	if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host
		|| baseUrl.includes('?') || baseUrl.includes('#')) {
		throw new DeployVerifyFailure(`target ${JSON.stringify(baseUrl)} (STREAM_KEEPR_DEPLOY_HEALTH_URL) is not an http(s) URL without query or fragment.`);
	}
	parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/api/time`;
	return parsed.href;
}

async function probe(url, { fetchRequest, timeoutMs, signal }) {
	let response;
	try {
		const timeout = AbortSignal.timeout(timeoutMs);
		response = await fetchRequest(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
	}
	catch (error) {
		if (signal?.aborted)
			throw signal.reason;
		const reason = error?.cause?.code ?? error?.name ?? 'error';
		throw new DeployVerifyFailure(`${url} could not be reached (${reason}).`, { retryable: true, cause: error });
	}
	const { status } = response;
	if (status >= 300 && status < 400) {
		const location = response.headers.get('location') ?? '(no location)';
		throw new DeployVerifyFailure(`${url} answered ${status} redirecting to ${location}; a redirect is never the Worker's clock reading, and is not followed.`);
	}
	if (status !== 200) {
		throw new DeployVerifyFailure(`${url} answered ${status}, not 200: ${excerpt(await response.text())}`, {
			retryable: status >= 500 || status === 429,
		});
	}
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json')
		throw new DeployVerifyFailure(`${url} answered ${status} with content-type "${contentType || '(none)'}", not application/json.`);
	const text = await response.text();
	let body;
	try {
		body = JSON.parse(text);
	}
	catch {
		throw new DeployVerifyFailure(`${url} answered ${status} with a body that is not valid JSON: ${excerpt(text)}`);
	}
	const serverTime = body !== null && typeof body === 'object' && !Array.isArray(body) ? body.serverTime : undefined;
	if (!Number.isSafeInteger(serverTime) || serverTime <= 0)
		throw new DeployVerifyFailure(`${url} answered ${status} with JSON that is not { serverTime: <epoch milliseconds> }: ${excerpt(text)}`);
	return { url, serverTime };
}

/**
 * Probe `<baseUrl>/api/time`, retrying only what a settling promotion can
 * answer. Resolves with the reading; rejects with a `DeployVerifyFailure`
 * (or `signal.reason` once `signal` aborts).
 *
 * `worker:smoke` calls this against the built Worker on workerd, so the
 * production bundle itself proves it passes the probe it is deployed behind.
 *
 * @param {{
 *   baseUrl: string,
 *   fetchRequest?: typeof fetch,
 *   attempts?: number,
 *   retryDelayMs?: number,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} options
 */
export async function verifyDeployment({
	baseUrl,
	fetchRequest = fetch,
	attempts = DEFAULT_ATTEMPTS,
	retryDelayMs = DEFAULT_RETRY_DELAY_MS,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	signal,
}) {
	const url = healthUrl(baseUrl);
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await probe(url, { fetchRequest, timeoutMs, signal });
		}
		catch (error) {
			if (!(error instanceof DeployVerifyFailure) || !error.retryable || attempt >= attempts)
				throw error;
			console.error(`deploy:verify: attempt ${attempt}/${attempts}: ${error.message} Retrying.`);
			await new Promise(resolve => setTimeout(resolve, retryDelayMs));
		}
	}
}

async function main() {
	const baseUrl = process.env.STREAM_KEEPR_DEPLOY_HEALTH_URL || DEFAULT_BASE_URL;
	try {
		const { url } = await verifyDeployment({ baseUrl });
		console.log(`deploy:verify: ${url} answered the Worker's clock reading: liveness only. `
			+ 'Not proven: which release is serving, or D1, auth, R2, KV, Ably and validator readiness '
			+ '(the deployed acceptance gates cover those).');
	}
	catch (error) {
		if (!(error instanceof DeployVerifyFailure))
			throw error;
		console.error(`deploy:verify: FAILED: ${error.message}`);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
	await main();
