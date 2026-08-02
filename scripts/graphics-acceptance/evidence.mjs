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
 *
 * "Evidence" here is not the Evidence Ledger. The ledger is a durable,
 * administrator-facing record of the library's own lifecycle and
 * reconciliation decisions, held in the catalogue for a year after the cleanup
 * it explains. This is transient output from a test harness, written to a
 * terminal and owned by nobody. What they share is one rule — neither may
 * carry object keys, content digests, filenames, delivery URLs, or capability
 * secrets — and that is the whole of the resemblance, so everything exported
 * here is prefixed `Acceptance` to keep the two apart at the call site.
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
	'delivery-cache-not-observable',
	'delivery-cache-never-hit',
	'delivery-authorization-skipped',
	'delivery-revocation-ineffective',
	// Origin and storage exposure.
	'cors-allow-origin-exposed',
	'cors-allow-credentials-exposed',
	'cors-preflight-permitted',
	'csp-directive-permissive',
	'csp-directive-unexpected',
	'csp-directive-missing',
	'private-storage-publicly-addressable',
	// Settled failure outcomes.
	'outcome-not-retryable-unavailable',
	'outcome-retry-after-missing',
	'outcome-retry-after-invalid',
	'outcome-retry-after-present',
	'outcome-not-missing-identity',
	'outcome-not-integrity-failure',
	'outcome-not-denied',
	'outcome-detail-disclosed',
	// Browser compatibility.
	'font-load-incomplete',
	'font-glyph-not-rendered',
	'font-silent-fallback-accepted',
	// A face the static-font-v1 profile rejects loaded here anyway, so the
	// server-side check and the browser disagree about the same bytes.
	'font-refused-face-loaded',
	'font-ready-before-load',
	'browser-driver-unavailable',
	'browser-acceptance-failed',
	'browser-acceptance-timed-out',
	// The product boundary let a restricted Screen Output through to a browser
	// that cannot show it correctly. What the browser would then have done is a
	// recorded fact rather than a code, because none of its answers is a defect
	// in this contract.
	'safari-vp9-alpha-not-blocked',
	'safari-vp9-alpha-transparency-rendered',
	// Template Package publication.
	'package-partial-assets-visible',
	'package-duplicate-commit',
	'package-retry-not-idempotent',
	'package-interrupted-result-exposed',
	// Harness plumbing.
	'harness-precondition-unmet',
	'harness-installation-unreachable',
]);

const FAILURE_CODES = new Set(ACCEPTANCE_FAILURE_CODES);

/**
 * A failure raised where it is discovered rather than where it is printed.
 *
 * Anything a harness throws reaches a terminal, so nothing may throw a raw
 * message built from a request path or a response body: those carry asset
 * identities, operation identities, and occasionally a capability. Raising
 * this instead keeps the stable code and its already-reduced detail together
 * until the formatter has checked them.
 */
export class AcceptanceFailure extends Error {
	constructor(code, detail = {}) {
		super(code);
		this.name = 'AcceptanceFailure';
		this.code = code;
		this.detail = detail;
	}
}

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
/**
 * Every path segment that is part of a route rather than part of an identity.
 *
 * The list is a whitelist on purpose. A denylist of identity shapes would have
 * to keep pace with every identifier the library mints, and the failure mode of
 * guessing wrong is printing the identity — so an unrecognised segment is
 * treated as an identity and withheld.
 */
const ROUTE_WORDS = new Set([
	'api',
	'_acceptance',
	'events',
	'event',
	'screens',
	'screen',
	'screen-output',
	'config',
	'feature-match-overlay',
	'broadcast-graphics',
	'asset-capability',
	'asset-capability-session',
	'template-packages',
	'feature-match-layout',
	'assets',
	'revisions',
	'content',
	'graphics-assets',
	'graphics-templates',
	'lifecycle-actions',
	'installed-templates',
	'ingestion-operations',
	'staged-source',
	'font-browser-evidence',
	'browser-evidence',
	'remote-copy',
	'template-package-confirmation',
	'template-package-installation',
	'retry',
	'thumbnail',
	'usage',
	'retention',
	'capacity',
	'status',
	'multipart',
	'parts',
	'replacement-operations',
	'admin',
	'graphics-style-sets',
	'packages',
]);

/**
 * Reduce any delivery URL to the route it exercised. The route is the useful
 * half of the evidence; the origin, asset identity, and revision identity are
 * the half that must not travel.
 */
export function deliveryRouteLabel(value) {
	const pathname = URL_PATTERN.test(value) ? new URL(value).pathname : value;
	const segments = pathname.split('/').filter(Boolean);
	const labelled = segments.map((segment, index) => {
		if (ROUTE_WORDS.has(segment))
			return segment;
		// Name the identity after whatever collection it belongs to, so the label
		// still says which route ran.
		return {
			'screens': ':screenId',
			'assets': ':assetId',
			'revisions': ':revisionId',
			'ingestion-operations': ':operationId',
			'events': ':eventId',
			'event': ':eventId',
			'graphics-assets': ':assetId',
			'installed-templates': ':templateId',
			'screen': ':screenSlug',
		}[segments[index - 1]] ?? ':id';
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
