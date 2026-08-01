import { describe, expect, it } from 'vitest';
import {
	checkCacheParity,
	checkCacheWarmed,
	checkCapabilityDenial,
	checkConditionalRead,
	checkContentSecurityPolicy,
	checkFullRead,
	checkNonRetryableIntegrity,
	checkNoStorageAddressing,
	checkOriginExposure,
	checkRangeRead,
	checkRetryableUnavailable,
	checkUnsatisfiableRange,
	checkValidatorStability,
} from '../../../scripts/graphics-acceptance/assertions.mjs';

const route = '/api/screen-output/screens/:screenId/assets/:assetId/revisions/:revisionId/content';
const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function observed(status: number, headers: Record<string, string>, body = new Uint8Array()) {
	return { status, headers: new Headers(headers), bytes: body };
}

const capabilityHeaders = {
	'accept-ranges': 'bytes',
	'cache-control': 'private, no-store',
	'content-length': '10',
	'content-type': 'image/png',
	'etag': '"sk-Kx3Qb7"',
	'vary': 'authorization, cookie',
};

const expectedFullRead = {
	route,
	bytes,
	contentType: 'image/png',
	cacheControl: 'private, no-store',
	vary: ['authorization', 'cookie'],
};

function codes(failures: { code: string }[]) {
	return failures.map(failure => failure.code);
}

describe('graphics staging delivery assertions', () => {
	it('accepts a complete capability read', () => {
		expect(checkFullRead(observed(200, capabilityHeaders, bytes), expectedFullRead)).toEqual([]);
	});

	it('rejects a read whose bytes differ from the pinned revision', () => {
		const corrupted = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
		expect(codes(checkFullRead(observed(200, capabilityHeaders, corrupted), expectedFullRead)))
			.toEqual(['delivery-body-mismatch']);
	});

	it('rejects a read that reports the wrong length, type, or status', () => {
		expect(codes(checkFullRead(
			observed(200, { ...capabilityHeaders, 'content-length': '9', 'content-type': 'image/webp' }, bytes),
			expectedFullRead,
		))).toEqual(['delivery-content-type-unexpected', 'delivery-content-length-unexpected']);
		expect(codes(checkFullRead(observed(503, capabilityHeaders, bytes), expectedFullRead)))
			.toContain('delivery-status-unexpected');
	});

	it('rejects a weak or absent validator and a missing range advertisement', () => {
		expect(codes(checkFullRead(
			observed(200, { ...capabilityHeaders, etag: 'W/"sk-Kx3Qb7"' }, bytes),
			expectedFullRead,
		))).toEqual(['delivery-validator-not-strong']);
		const withoutValidator = new Headers(capabilityHeaders);
		withoutValidator.delete('etag');
		withoutValidator.delete('accept-ranges');
		expect(codes(checkFullRead(
			{ status: 200, headers: withoutValidator, bytes },
			expectedFullRead,
		))).toEqual(['delivery-validator-missing', 'delivery-accept-ranges-missing']);
	});

	it('rejects a capability read a shared cache would be allowed to keep', () => {
		expect(codes(checkFullRead(
			observed(200, { ...capabilityHeaders, 'cache-control': 'public, max-age=31536000, immutable' }, bytes),
			expectedFullRead,
		))).toEqual(['delivery-cache-directive-unexpected']);
		expect(codes(checkFullRead(
			observed(200, { ...capabilityHeaders, vary: 'cookie' }, bytes),
			expectedFullRead,
		))).toEqual(['delivery-vary-incomplete']);
	});

	it('accepts a conditional read answered with 304 and no body', () => {
		expect(checkConditionalRead(
			observed(304, { etag: '"sk-Kx3Qb7"' }),
			{ route, etag: '"sk-Kx3Qb7"' },
		)).toEqual([]);
	});

	it('rejects a conditional read that re-sends the representation', () => {
		expect(codes(checkConditionalRead(
			observed(200, { etag: '"sk-Kx3Qb7"' }, bytes),
			{ route, etag: '"sk-Kx3Qb7"' },
		))).toEqual(['delivery-conditional-not-honoured']);
		expect(codes(checkConditionalRead(
			observed(304, { etag: '"sk-Kx3Qb7"' }, bytes),
			{ route, etag: '"sk-Kx3Qb7"' },
		))).toEqual(['delivery-conditional-body-present']);
	});

	it('accepts a byte range that carries exactly the requested window', () => {
		expect(checkRangeRead(
			observed(
				206,
				{ ...capabilityHeaders, 'content-length': '4', 'content-range': 'bytes 2-5/10' },
				bytes.slice(2, 6),
			),
			{ route, start: 2, end: 5, byteLength: 10, bytes: bytes.slice(2, 6) },
		)).toEqual([]);
	});

	it('rejects a byte range answered with the whole representation', () => {
		expect(codes(checkRangeRead(
			observed(200, capabilityHeaders, bytes),
			{ route, start: 2, end: 5, byteLength: 10, bytes: bytes.slice(2, 6) },
		))).toContain('delivery-range-status-unexpected');
		expect(codes(checkRangeRead(
			observed(
				206,
				{ ...capabilityHeaders, 'content-length': '4', 'content-range': 'bytes 0-3/10' },
				bytes.slice(2, 6),
			),
			{ route, start: 2, end: 5, byteLength: 10, bytes: bytes.slice(2, 6) },
		))).toEqual(['delivery-content-range-unexpected']);
	});

	it('requires an unsatisfiable range to be refused rather than clamped', () => {
		expect(checkUnsatisfiableRange(
			observed(416, { 'content-range': 'bytes */10' }),
			{ route, byteLength: 10 },
		)).toEqual([]);
		expect(codes(checkUnsatisfiableRange(
			observed(206, { 'content-range': 'bytes 0-9/10' }, bytes),
			{ route, byteLength: 10 },
		))).toEqual(['delivery-unsatisfiable-range-not-refused']);
	});

	it('requires one representation to keep one validator across reads', () => {
		expect(checkValidatorStability(['"sk-Kx3Qb7"', '"sk-Kx3Qb7"'], { route })).toEqual([]);
		expect(codes(checkValidatorStability(['"sk-Kx3Qb7"', '"sk-Zz9Ppp"'], { route })))
			.toEqual(['delivery-validator-unstable']);
	});

	it('requires a repeated read to be byte-identical to the first', () => {
		const first = observed(200, capabilityHeaders, bytes);
		expect(checkCacheParity(first, observed(200, capabilityHeaders, bytes), { route })).toEqual([]);
		expect(codes(checkCacheParity(
			first,
			observed(200, { ...capabilityHeaders, etag: '"sk-Zz9Ppp"' }, bytes),
			{ route },
		))).toEqual(['delivery-cache-parity-broken']);
	});

	it('reads cache warmth from the age the edge reports', () => {
		expect(checkCacheWarmed(observed(200, { ...capabilityHeaders, age: '3' }), { route })).toEqual([]);
		expect(codes(checkCacheWarmed(observed(200, capabilityHeaders), { route })))
			.toEqual(['delivery-cache-never-hit']);
	});

	it('rejects any cross-origin grant on a delivery response', () => {
		expect(checkOriginExposure(new Headers(capabilityHeaders), { route })).toEqual([]);
		expect(codes(checkOriginExposure(
			new Headers({ ...capabilityHeaders, 'access-control-allow-origin': '*' }),
			{ route },
		))).toEqual(['cors-allow-origin-exposed']);
		expect(codes(checkOriginExposure(
			new Headers({ ...capabilityHeaders, 'access-control-allow-credentials': 'true' }),
			{ route },
		))).toEqual(['cors-allow-credentials-exposed']);
	});

	it('accepts an absent policy but rejects one that widens the output origin', () => {
		expect(checkContentSecurityPolicy(new Headers(), { route })).toEqual([]);
		expect(checkContentSecurityPolicy(
			new Headers({ 'content-security-policy': 'default-src \'self\' data: blob:' }),
			{ route },
		)).toEqual([]);
		expect(codes(checkContentSecurityPolicy(
			new Headers({ 'content-security-policy': 'default-src *' }),
			{ route },
		))).toEqual(['csp-directive-permissive']);
	});

	it('rejects a response that addresses canonical storage', () => {
		expect(checkNoStorageAddressing(new Headers(capabilityHeaders), { route })).toEqual([]);
		expect(codes(checkNoStorageAddressing(
			new Headers({ ...capabilityHeaders, 'x-amz-request-id': 'abc' }),
			{ route },
		))).toEqual(['private-storage-publicly-addressable']);
		expect(codes(checkNoStorageAddressing(
			new Headers({ ...capabilityHeaders, 'content-disposition': 'attachment; filename="sponsor.png"' }),
			{ route },
		))).toEqual(['private-storage-publicly-addressable']);
	});

	it('requires an unavailable read to invite a retry', () => {
		expect(checkRetryableUnavailable(observed(503, { 'retry-after': '5' }), { route })).toEqual([]);
		expect(codes(checkRetryableUnavailable(observed(503, {}), { route })))
			.toEqual(['outcome-retry-after-missing']);
		expect(codes(checkRetryableUnavailable(observed(503, { 'retry-after': 'soon' }), { route })))
			.toEqual(['outcome-retry-after-invalid']);
		expect(codes(checkRetryableUnavailable(observed(404, {}), { route })))
			.toEqual(['outcome-not-retryable-unavailable', 'outcome-retry-after-missing']);
	});

	it('requires a missing identity or revision to refuse a retry', () => {
		expect(checkNonRetryableIntegrity(observed(404, {}), { route })).toEqual([]);
		expect(codes(checkNonRetryableIntegrity(observed(503, { 'retry-after': '5' }), { route })))
			.toEqual(['outcome-not-integrity-failure', 'outcome-retry-after-present']);
	});

	it('requires a denied capability to disclose nothing about the asset', () => {
		expect(checkCapabilityDenial(
			observed(404, {}),
			{ route, body: 'Graphic Asset Revision is not available to this Screen Output' },
		)).toEqual([]);
		expect(codes(checkCapabilityDenial(
			observed(404, {}),
			{ route, body: 'r2 bucket canonical object key missing' },
		))).toEqual(['outcome-detail-disclosed']);
		expect(codes(checkCapabilityDenial(observed(403, {}), { route, body: '' })))
			.toEqual(['outcome-not-denied']);
	});
});
