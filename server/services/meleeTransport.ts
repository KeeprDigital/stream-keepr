import type { z } from 'zod';
import { Buffer } from 'node:buffer';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type MeleeEndpoint
	= | 'event'
		| 'players'
		| 'current_standings'
		| 'round_standings'
		| 'round_matches';

export type MeleeFailureCategory
	= | 'http'
		| 'network'
		| 'timeout'
		| 'response_parse'
		| 'response_size'
		| 'schema_validation';

export class MeleeTransportError extends Error {
	readonly code = 'MELEE_UPSTREAM_FAILURE';

	constructor(
		message: string,
		public readonly category: MeleeFailureCategory,
		public readonly upstreamStatus: number | null = null,
		options?: { cause?: unknown },
	) {
		super(message, options?.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'MeleeTransportError';
	}
}

interface MeleeTransportLogEntry {
	service: 'melee';
	event: 'api_request';
	endpoint: MeleeEndpoint;
	page: number | null;
	outcome: 'success' | 'retry' | 'failure';
	durationMs: number;
	attempt: number;
	retryCount: number;
	status: number | null;
	failureCategory?: MeleeFailureCategory;
	retryDelayMs?: number;
	retryDelaySource?: 'exponential_backoff' | 'retry_after';
}

interface MeleeTransportLogger {
	info: (entry: MeleeTransportLogEntry) => void;
	warn: (entry: MeleeTransportLogEntry) => void;
	error: (entry: MeleeTransportLogEntry) => void;
}

interface MeleeTransportCredentials {
	clientId: string;
	clientSecret: string;
}

/**
 * Optional transport controls. Existing callers do not need to provide these;
 * the injectable functions keep retry and timeout behaviour deterministic in
 * unit tests without introducing mutable module-level state.
 */
export interface MeleeServiceOptions {
	requestTimeoutMs?: number;
	maxAttempts?: number;
	baseRetryDelayMs?: number;
	maxRetryDelayMs?: number;
	fetch?: typeof globalThis.fetch;
	sleep?: (delayMs: number) => Promise<void>;
	now?: () => number;
	random?: () => number;
	createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
	logger?: MeleeTransportLogger;
	/** Maximum decoded JSON bytes accepted for one upstream response. */
	maxResponseBytes?: number;
	/** Maximum accumulated items accepted from one paginated endpoint. */
	maxCollectionItems?: number;
	/** Maximum approximate JSON bytes accumulated across a paginated endpoint. */
	maxCollectionBytes?: number;
}

export interface MeleeRequestContext {
	endpoint: MeleeEndpoint;
	page?: number;
}

function requireIntegerInRange(
	name: string,
	value: number | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const resolved = value ?? fallback;

	if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
		throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
	}

	return resolved;
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
	if (!value) {
		return null;
	}

	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		return Number.parseInt(trimmed, 10) * 1_000;
	}

	const retryAt = Date.parse(trimmed);
	if (!Number.isFinite(retryAt)) {
		return null;
	}

	return Math.max(0, retryAt - nowMs);
}

function defaultSleep(delayMs: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, delayMs));
}

function elapsedMs(now: () => number, startedAt: number): number {
	return Math.max(0, Math.round(now() - startedAt));
}

function isTimeoutError(error: unknown, signal: AbortSignal): boolean {
	if (signal.aborted) {
		return true;
	}

	return error instanceof DOMException
		&& (error.name === 'TimeoutError' || error.name === 'AbortError');
}

class MeleeResponseTooLargeError extends Error {
	constructor() {
		super('Melee.gg API response exceeded the configured size limit');
		this.name = 'MeleeResponseTooLargeError';
	}
}

class MeleeResponseParseError extends Error {
	constructor(cause: unknown) {
		super('Melee.gg API returned an invalid JSON response', { cause });
		this.name = 'MeleeResponseParseError';
	}
}

export function createMeleeTransport(
	credentials: MeleeTransportCredentials,
	options: MeleeServiceOptions = {},
) {
	const requestTimeoutMs = requireIntegerInRange(
		'requestTimeoutMs',
		options.requestTimeoutMs,
		DEFAULT_REQUEST_TIMEOUT_MS,
		1,
		MAX_REQUEST_TIMEOUT_MS,
	);
	const maxAttempts = requireIntegerInRange(
		'maxAttempts',
		options.maxAttempts,
		DEFAULT_MAX_ATTEMPTS,
		1,
		MAX_ATTEMPTS,
	);
	const baseRetryDelayMs = requireIntegerInRange(
		'baseRetryDelayMs',
		options.baseRetryDelayMs,
		DEFAULT_BASE_RETRY_DELAY_MS,
		0,
		MAX_RETRY_DELAY_MS,
	);
	const maxRetryDelayMs = requireIntegerInRange(
		'maxRetryDelayMs',
		options.maxRetryDelayMs,
		DEFAULT_MAX_RETRY_DELAY_MS,
		0,
		MAX_RETRY_DELAY_MS,
	);
	const maxResponseBytes = requireIntegerInRange(
		'maxResponseBytes',
		options.maxResponseBytes,
		DEFAULT_MAX_RESPONSE_BYTES,
		1_024,
		MAX_RESPONSE_BYTES,
	);

	if (maxRetryDelayMs < baseRetryDelayMs) {
		throw new TypeError('maxRetryDelayMs must be greater than or equal to baseRetryDelayMs');
	}

	const fetchImplementation = options.fetch ?? globalThis.fetch;
	const sleep = options.sleep ?? defaultSleep;
	const now = options.now ?? Date.now;
	const random = options.random ?? Math.random;
	const createTimeoutSignal = options.createTimeoutSignal ?? AbortSignal.timeout;
	const logger = options.logger ?? {
		// Workers Logs indexes structured objects emitted through console.log.
		// eslint-disable-next-line no-console
		info: (entry: MeleeTransportLogEntry) => console.log(entry),
		warn: (entry: MeleeTransportLogEntry) => console.warn(entry),
		error: (entry: MeleeTransportLogEntry) => console.error(entry),
	};
	const authHeader = `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`;

	const log = (level: keyof MeleeTransportLogger, entry: MeleeTransportLogEntry): void => {
		try {
			logger[level](entry);
		}
		catch {
			// Observability must never alter sync behaviour.
		}
	};

	const logEntry = (
		context: MeleeRequestContext,
		requestStartedAt: number,
		attempt: number,
		status: number | null,
		outcome: MeleeTransportLogEntry['outcome'],
		details: Pick<
			MeleeTransportLogEntry,
			'failureCategory' | 'retryDelayMs' | 'retryDelaySource'
		> = {},
	): MeleeTransportLogEntry => ({
		service: 'melee',
		event: 'api_request',
		endpoint: context.endpoint,
		page: context.page ?? null,
		outcome,
		durationMs: elapsedMs(now, requestStartedAt),
		attempt,
		retryCount: outcome === 'retry' ? attempt : attempt - 1,
		status,
		...details,
	});

	const retryDelay = (
		attempt: number,
		retryAfterHeader: string | null,
	): { delayMs: number; source: 'exponential_backoff' | 'retry_after' } => {
		const retryAfterMs = parseRetryAfter(retryAfterHeader, now());
		if (retryAfterMs !== null) {
			return {
				delayMs: Math.min(retryAfterMs, maxRetryDelayMs),
				source: 'retry_after',
			};
		}

		const exponentialDelay = Math.min(
			baseRetryDelayMs * 2 ** (attempt - 1),
			maxRetryDelayMs,
		);
		const jitter = 0.5 + Math.min(1, Math.max(0, random())) * 0.5;

		return {
			delayMs: Math.round(exponentialDelay * jitter),
			source: 'exponential_backoff',
		};
	};

	const cancelResponseBody = async (response: Response): Promise<void> => {
		try {
			await response.body?.cancel();
		}
		catch {
			// Best-effort resource cleanup before a retry.
		}
	};

	const readJsonBody = async (response: Response): Promise<unknown> => {
		const declaredLength = response.headers?.get('Content-Length');
		if (declaredLength && /^\d+$/.test(declaredLength.trim()) && Number(declaredLength) > maxResponseBytes) {
			await cancelResponseBody(response);
			throw new MeleeResponseTooLargeError();
		}

		if (!response.body) {
			const value = await response.json();
			if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxResponseBytes)
				throw new MeleeResponseTooLargeError();
			return value;
		}

		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let totalBytes = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done)
					break;
				totalBytes += value.byteLength;
				if (totalBytes > maxResponseBytes) {
					await reader.cancel().catch(() => undefined);
					throw new MeleeResponseTooLargeError();
				}
				chunks.push(value);
			}
		}
		finally {
			reader.releaseLock();
		}

		const bytes = new Uint8Array(totalBytes);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		try {
			return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		}
		catch (error) {
			throw new MeleeResponseParseError(error);
		}
	};

	/**
	 * Performs one validated GET request. URLs and payloads are deliberately
	 * excluded from telemetry; callers provide a finite endpoint label instead.
	 */
	const fetchValidated = async <S extends z.ZodTypeAny>(
		url: string,
		schema: S,
		context: MeleeRequestContext,
	): Promise<z.infer<S>> => {
		const requestStartedAt = now();

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const signal = createTimeoutSignal(requestTimeoutMs);
			let response: Response;

			try {
				response = await fetchImplementation(url, {
					headers: {
						'Authorization': authHeader,
						'Content-Type': 'application/json',
					},
					signal,
				});
			}
			catch (error) {
				const failureCategory: MeleeFailureCategory = isTimeoutError(error, signal)
					? 'timeout'
					: 'network';

				if (attempt < maxAttempts) {
					const delay = retryDelay(attempt, null);
					log('warn', logEntry(context, requestStartedAt, attempt, null, 'retry', {
						failureCategory,
						retryDelayMs: delay.delayMs,
						retryDelaySource: delay.source,
					}));
					await sleep(delay.delayMs);
					continue;
				}

				log('error', logEntry(context, requestStartedAt, attempt, null, 'failure', {
					failureCategory,
				}));
				throw new MeleeTransportError(
					`Melee.gg API request failed: ${failureCategory}`,
					failureCategory,
					null,
					{ cause: error },
				);
			}

			const status = Number.isInteger(response.status) ? response.status : null;
			if (!response.ok) {
				const isRetryable = status !== null && RETRYABLE_STATUS_CODES.has(status);
				if (isRetryable && attempt < maxAttempts) {
					const delay = retryDelay(attempt, response.headers?.get('Retry-After') ?? null);
					await cancelResponseBody(response);
					log('warn', logEntry(context, requestStartedAt, attempt, status, 'retry', {
						failureCategory: 'http',
						retryDelayMs: delay.delayMs,
						retryDelaySource: delay.source,
					}));
					await sleep(delay.delayMs);
					continue;
				}

				await cancelResponseBody(response);
				log('error', logEntry(context, requestStartedAt, attempt, status, 'failure', {
					failureCategory: 'http',
				}));
				throw new MeleeTransportError(
					`Melee.gg API request failed with status ${status ?? 'unknown'}`,
					'http',
					status,
				);
			}

			let raw: unknown;
			try {
				raw = await readJsonBody(response);
			}
			catch (error) {
				const failureCategory: MeleeFailureCategory = isTimeoutError(error, signal)
					? 'timeout'
					: error instanceof MeleeResponseTooLargeError
						? 'response_size'
						: error instanceof SyntaxError || error instanceof MeleeResponseParseError
							? 'response_parse'
							: 'network';
				const retryableBodyFailure = failureCategory === 'timeout' || failureCategory === 'network';
				if (retryableBodyFailure && attempt < maxAttempts) {
					const delay = retryDelay(attempt, null);
					await cancelResponseBody(response);
					log('warn', logEntry(context, requestStartedAt, attempt, status, 'retry', {
						failureCategory,
						retryDelayMs: delay.delayMs,
						retryDelaySource: delay.source,
					}));
					await sleep(delay.delayMs);
					continue;
				}

				log('error', logEntry(context, requestStartedAt, attempt, status, 'failure', {
					failureCategory,
				}));
				throw new MeleeTransportError(
					failureCategory === 'response_parse'
						? 'Melee.gg API returned an invalid JSON response'
						: failureCategory === 'response_size'
							? 'Melee.gg API response exceeded the configured size limit'
							: `Melee.gg API response body failed: ${failureCategory}`,
					failureCategory,
					status,
					{ cause: error },
				);
			}

			const parsed = schema.safeParse(raw);
			if (!parsed.success) {
				log('error', logEntry(context, requestStartedAt, attempt, status, 'failure', {
					failureCategory: 'schema_validation',
				}));
				// Zod issues can contain rejected upstream values. Keep the durable sync
				// error and HTTP response limited to the safe, low-cardinality endpoint.
				throw new MeleeTransportError(
					`Melee.gg API response failed schema validation for ${context.endpoint}`,
					'schema_validation',
					status,
				);
			}

			log('info', logEntry(context, requestStartedAt, attempt, status, 'success'));
			return parsed.data;
		}

		throw new MeleeTransportError(
			'Melee.gg API request failed after exhausting retries',
			'network',
		);
	};

	return { fetchValidated };
}
