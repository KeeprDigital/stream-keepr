/**
 * The assertion core the delivery harnesses share between their local and
 * deployed modes.
 *
 * Every function takes an already-read observation — `{ status, headers,
 * bytes }` — and returns the failures it found, so the same expectations run
 * against `wrangler dev --local` and against the deployed installation without
 * a second copy of the contract. Nothing here performs I/O or prints: the
 * harness collects the failures and hands them to the evidence formatter,
 * which is the only place output is produced.
 */

function failure(code, detail) {
	return { code, detail };
}

function sameBytes(actual, expected) {
	if (actual.byteLength !== expected.byteLength)
		return false;
	return actual.every((byte, index) => byte === expected[index]);
}

function checkStatus(observation, expected, route) {
	return observation.status === expected
		? []
		: [failure('delivery-status-unexpected', {
				route,
				expected,
				actual: observation.status,
			})];
}

function checkValidator(headers, route) {
	const etag = headers.get('etag');
	if (!etag)
		return [failure('delivery-validator-missing', { route })];
	if (/^W\//i.test(etag.trim()))
		return [failure('delivery-validator-not-strong', { route, shape: 'weak' })];
	if (!/^"[^"]+"$/.test(etag.trim()))
		return [failure('delivery-validator-not-strong', { route, shape: 'unquoted' })];
	return [];
}

/**
 * A complete read of one pinned Graphic Asset Revision.
 *
 * @param {{ status: number, headers: Headers, bytes: Uint8Array }} observation
 * @param {{
 *   route: string,
 *   bytes: Uint8Array,
 *   contentType: string,
 *   cacheControl: string,
 *   vary: readonly string[],
 * }} expected
 */
export function checkFullRead(observation, expected) {
	const { headers } = observation;
	const failures = [
		...checkStatus(observation, 200, expected.route),
		...checkValidator(headers, expected.route),
	];
	if (headers.get('accept-ranges') !== 'bytes')
		failures.push(failure('delivery-accept-ranges-missing', { route: expected.route }));
	if (headers.get('content-type') !== expected.contentType) {
		failures.push(failure('delivery-content-type-unexpected', {
			route: expected.route,
			expected: expected.contentType,
			actual: headers.get('content-type') ?? 'absent',
		}));
	}
	if (headers.get('content-length') !== String(expected.bytes.byteLength)) {
		failures.push(failure('delivery-content-length-unexpected', {
			route: expected.route,
			expected: expected.bytes.byteLength,
			actual: headers.get('content-length') ?? 'absent',
		}));
	}
	if (headers.get('cache-control') !== expected.cacheControl) {
		failures.push(failure('delivery-cache-directive-unexpected', {
			route: expected.route,
			expected: expected.cacheControl,
			actual: headers.get('cache-control') ?? 'absent',
		}));
	}
	const vary = (headers.get('vary') ?? '').split(',').map(value => value.trim().toLowerCase());
	if (!expected.vary.every(name => vary.includes(name))) {
		failures.push(failure('delivery-vary-incomplete', {
			route: expected.route,
			expected: expected.vary.join(' '),
			actual: vary.join(' ') || 'absent',
		}));
	}
	if (!sameBytes(observation.bytes, expected.bytes)) {
		failures.push(failure('delivery-body-mismatch', {
			route: expected.route,
			expected: expected.bytes.byteLength,
			actual: observation.bytes.byteLength,
		}));
	}
	return failures;
}

/** A conditional read the installation already answered once. */
export function checkConditionalRead(observation, { route, etag }) {
	const failures = [];
	if (observation.status !== 304) {
		failures.push(failure('delivery-conditional-not-honoured', {
			route,
			expected: 304,
			actual: observation.status,
		}));
	}
	// A 200 carrying the representation is already reported above; only a 304
	// that still ships bytes is a second, separate breach of the contract.
	if (observation.status === 304 && observation.bytes.byteLength > 0)
		failures.push(failure('delivery-conditional-body-present', { route }));
	if (observation.headers.get('etag') && observation.headers.get('etag') !== etag)
		failures.push(failure('delivery-validator-unstable', { route }));
	return failures;
}

/** One requested window of an immutable representation. */
export function checkRangeRead(observation, { route, start, end, byteLength, bytes }) {
	const failures = [...checkStatus(observation, 206, route)];
	if (observation.status !== 206)
		failures[0] = failure('delivery-range-status-unexpected', { route, expected: 206, actual: observation.status });
	const expectedRange = `bytes ${start}-${end}/${byteLength}`;
	if (observation.headers.get('content-range') !== expectedRange) {
		failures.push(failure('delivery-content-range-unexpected', {
			route,
			expected: expectedRange,
			actual: observation.headers.get('content-range') ?? 'absent',
		}));
	}
	if (!sameBytes(observation.bytes, bytes)) {
		failures.push(failure('delivery-range-body-mismatch', {
			route,
			expected: bytes.byteLength,
			actual: observation.bytes.byteLength,
		}));
	}
	return failures;
}

/** A range beyond the representation must be refused, never clamped. */
export function checkUnsatisfiableRange(observation, { route, byteLength }) {
	const expectedRange = `bytes */${byteLength}`;
	if (
		observation.status !== 416
		|| observation.headers.get('content-range') !== expectedRange
		|| observation.bytes.byteLength > 0
	) {
		return [failure('delivery-unsatisfiable-range-not-refused', {
			route,
			expected: 416,
			actual: observation.status,
		})];
	}
	return [];
}

/** One representation keeps one strong validator for as long as it exists. */
export function checkValidatorStability(validators, { route }) {
	const distinct = new Set(validators.filter(Boolean));
	if (validators.some(validator => !validator))
		return [failure('delivery-validator-missing', { route })];
	return distinct.size === 1
		? []
		: [failure('delivery-validator-unstable', { route, actual: distinct.size })];
}

/**
 * A second read of the same revision — served from cache or not — is the same
 * representation. This is the invariant a cache is allowed to preserve and the
 * only one a harness can observe from outside.
 */
export function checkCacheParity(first, second, { route }) {
	const differs = first.status !== second.status
		|| first.headers.get('etag') !== second.headers.get('etag')
		|| first.headers.get('content-length') !== second.headers.get('content-length')
		|| !sameBytes(first.bytes, second.bytes);
	return differs ? [failure('delivery-cache-parity-broken', { route })] : [];
}

/**
 * Cloudflare's Cache API stamps a stored response with the age it has spent
 * there, so a warm read carries `age` and a cold one does not. Only the
 * deployed run can observe this; local Wrangler has no edge cache to warm.
 */
export function checkCacheWarmed(observation, { route }) {
	return observation.headers.get('age') === null
		? [failure('delivery-cache-never-hit', { route })]
		: [];
}

/** Delivery is same-origin. Nothing grants another origin a read. */
export function checkOriginExposure(headers, { route }) {
	const failures = [];
	if (headers.get('access-control-allow-origin')) {
		failures.push(failure('cors-allow-origin-exposed', {
			route,
			actual: headers.get('access-control-allow-origin'),
		}));
	}
	if (headers.get('access-control-allow-credentials'))
		failures.push(failure('cors-allow-credentials-exposed', { route }));
	return failures;
}

/**
 * The output document may declare no policy — same-origin delivery is enforced
 * by the capability, not by a policy header — but a declared policy must not
 * widen where output content may come from.
 */
export function checkContentSecurityPolicy(headers, { route }) {
	const policy = headers.get('content-security-policy');
	if (!policy)
		return [];
	const permissive = policy
		.split(';')
		.map(directive => directive.trim())
		.filter(directive => /^(?:default|script|media|img|font|connect|frame)-src\b/.test(directive))
		.filter(directive => /(?:^|\s)\*(?:$|\s)/.test(directive) || /\shttps?:(?:$|\s)/.test(directive));
	return permissive.length === 0
		? []
		: [failure('csp-directive-permissive', {
				route,
				actual: permissive[0].split(/\s+/)[0],
			})];
}

/**
 * Canonical storage is private. A public response therefore carries no way to
 * address the object behind it: no provider request identity, no bucket or key
 * echo, and no source filename.
 */
export function checkNoStorageAddressing(headers, { route }) {
	const addressing = [];
	for (const [name, value] of headers) {
		if (/^(?:x-amz-|x-goog-|cf-r2-|x-object-|x-bucket)/i.test(name))
			addressing.push(name);
		if (name === 'content-disposition' && /filename/i.test(value))
			addressing.push(name);
		if (name === 'content-location')
			addressing.push(name);
	}
	return addressing.length === 0
		? []
		: [failure('private-storage-publicly-addressable', { route, header: addressing[0] })];
}

/** Content the installation holds but cannot read right now. */
export function checkRetryableUnavailable(observation, { route }) {
	const failures = [];
	if (observation.status !== 503) {
		failures.push(failure('outcome-not-retryable-unavailable', {
			route,
			expected: 503,
			actual: observation.status,
		}));
	}
	const retryAfter = observation.headers.get('retry-after');
	if (retryAfter === null)
		failures.push(failure('outcome-retry-after-missing', { route }));
	else if (!/^\d+$/.test(retryAfter.trim()))
		failures.push(failure('outcome-retry-after-invalid', { route }));
	return failures;
}

/** A missing identity or revision is settled: retrying cannot help. */
export function checkNonRetryableIntegrity(observation, { route }) {
	const failures = [];
	if (observation.status !== 404) {
		failures.push(failure('outcome-not-integrity-failure', {
			route,
			expected: 404,
			actual: observation.status,
		}));
	}
	if (observation.headers.get('retry-after') !== null)
		failures.push(failure('outcome-retry-after-present', { route }));
	return failures;
}

/**
 * A denied capability is answered exactly like an absent one, and says nothing
 * about whether the revision exists or where its bytes live.
 */
export function checkCapabilityDenial(observation, { route, body }) {
	const failures = [];
	if (observation.status !== 404) {
		failures.push(failure('outcome-not-denied', {
			route,
			expected: 404,
			actual: observation.status,
		}));
	}
	if (observation.headers.get('retry-after') !== null)
		failures.push(failure('outcome-retry-after-present', { route }));
	if (/\b(?:r2|bucket|object key|s3|staging key|canonical key)\b/i.test(body ?? ''))
		failures.push(failure('outcome-detail-disclosed', { route }));
	return failures;
}
