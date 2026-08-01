/**
 * The one output path every staging acceptance harness prints through.
 *
 * The deployment gate has to say what broke without becoming a disclosure of
 * its own: a run happens against the real installation, so its transcript ends
 * up in terminals, CI logs, and pasted issue comments. Every line therefore
 * carries a stable code from a published registry and detail values that have
 * been checked — not merely trusted — to be free of secrets, capability
 * tokens, source filenames, object keys, and full delivery URLs. A leak is
 * itself a failure, reported with the field that carried it and nothing else.
 */

/** Every code a harness may print. Codes are contract; add, never rename. */
export const ACCEPTANCE_FAILURE_CODES = Object.freeze([
	// Delivery semantics.
	'delivery-status-unexpected',
	'delivery-content-type-unexpected',
	'delivery-content-length-unexpected',
	'delivery-body-mismatch',
	'delivery-validator-missing',
	'delivery-validator-not-strong',
	'delivery-validator-unstable',
	'delivery-accept-ranges-missing',
	'delivery-conditional-not-honoured',
	'delivery-conditional-body-present',
	'delivery-range-status-unexpected',
	'delivery-content-range-unexpected',
	'delivery-range-body-mismatch',
	'delivery-unsatisfiable-range-not-refused',
	'delivery-cache-directive-unexpected',
	'delivery-vary-incomplete',
	'delivery-cache-parity-broken',
	'delivery-cache-state-unreported',
	'delivery-cache-never-hit',
	'delivery-authorization-skipped',
	'delivery-revocation-ineffective',
	// Origin and storage exposure.
	'cors-allow-origin-exposed',
	'cors-allow-credentials-exposed',
	'cors-preflight-permitted',
	'csp-directive-permissive',
	'private-storage-publicly-addressable',
	// Settled failure outcomes.
	'outcome-not-retryable-unavailable',
	'outcome-retry-after-missing',
	'outcome-retry-after-invalid',
	'outcome-retry-after-present',
	'outcome-not-integrity-failure',
	'outcome-not-denied',
	'outcome-detail-disclosed',
	// Browser compatibility.
	'font-load-incomplete',
	'font-glyph-not-rendered',
	'font-silent-fallback-accepted',
	'font-ready-before-load',
	'browser-driver-unavailable',
	'browser-acceptance-failed',
	'browser-acceptance-timed-out',
	'safari-vp9-alpha-not-blocked',
	'safari-vp9-alpha-substituted',
	// Template Package publication.
	'package-partial-assets-visible',
	'package-duplicate-commit',
	'package-retry-not-idempotent',
	'package-interrupted-result-exposed',
	// Harness plumbing.
	'harness-precondition-unmet',
]);

const FAILURE_CODES = new Set(ACCEPTANCE_FAILURE_CODES);

const MAX_DETAIL_LENGTH = 120;
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\//i;
const FILENAME_PATTERN
	= /\.(?:png|jpe?g|webp|gif|mp4|webm|mov|woff2?|ttf|otf|eot|zip|sklayout|skgraphic|skstyle|json|html?|txt)\b/i;
/**
 * Object keys, capability tokens, digests, and representation tags are all
 * long unbroken runs of token characters. Domain vocabulary is not: real
 * detail values are hyphenated words, header values, or numbers.
 */
const OPAQUE_TOKEN_PATTERN = /\w{16,}/;

/**
 * Reduce any delivery URL to the route it exercised. The route is the useful
 * half of the evidence; the origin, asset identity, and revision identity are
 * the half that must not travel.
 */
export function deliveryRouteLabel(value) {
	const pathname = URL_PATTERN.test(value) ? new URL(value).pathname : value;
	const segments = pathname.split('/').filter(Boolean);
	// Collections whose own children are route words rather than identities.
	const collectionWords = new Set(['capacity', 'installed-templates', 'ingestion-operations']);
	const labelled = segments.map((segment, index) => {
		const previous = segments[index - 1];
		if (previous === 'screens')
			return ':screenId';
		if (previous === 'assets')
			return ':assetId';
		if (previous === 'revisions')
			return ':revisionId';
		if (previous === 'ingestion-operations')
			return ':operationId';
		if (previous === 'events')
			return ':eventId';
		if (previous === 'graphics-assets')
			return collectionWords.has(segment) ? segment : ':assetId';
		return segment;
	});
	return `/${labelled.join('/')}`;
}

function leakCode(value, secrets) {
	for (const secret of secrets) {
		if (secret && value.includes(secret))
			return 'evidence-secret-leak';
	}
	if (value.length > MAX_DETAIL_LENGTH)
		return 'evidence-detail-too-long';
	if (URL_PATTERN.test(value))
		return 'evidence-url-leak';
	if (FILENAME_PATTERN.test(value))
		return 'evidence-filename-leak';
	if (OPAQUE_TOKEN_PATTERN.test(value))
		return 'evidence-opaque-token-leak';
	return undefined;
}

/**
 * @param {{ harness: string, secrets?: readonly string[] }} options
 */
export function createAcceptanceEvidence({ harness, secrets = [] }) {
	const registered = new Set(secrets.filter(Boolean));

	function line(code, detail) {
		const parts = [harness, code];
		for (const [field, raw] of Object.entries(detail ?? {})) {
			const value = String(raw);
			const leak = leakCode(value, registered);
			if (leak)
				throw new Error(`${harness} ${leak} field=${field}`);
			parts.push(`${field}=${value}`);
		}
		return parts.join(' ');
	}

	return {
		/** Values added here are refused everywhere the harness prints. */
		addSecret(value) {
			if (value)
				registered.add(String(value));
		},
		report(failures) {
			return failures.map(({ code, detail }) => {
				if (!FAILURE_CODES.has(code))
					throw new Error(`${harness} evidence-unknown-code`);
				return line(code, detail);
			}).join('\n');
		},
		passed(detail) {
			return line('acceptance passed', detail);
		},
		/** Nothing was disproved and nothing was proved: a human still owes an observation. */
		deferred(detail) {
			return line('acceptance deferred', detail);
		},
	};
}
