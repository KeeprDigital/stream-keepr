import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ACCEPTANCE_FAILURE_CODES,
	createAcceptanceEvidence,
	deliveryRouteLabel,
} from '../../../scripts/graphics-acceptance/evidence.mjs';
import { runAcceptanceHarness } from '../../../scripts/graphics-acceptance/harness.mjs';
import { acceptanceOrigin } from '../../../scripts/graphics-acceptance/installation.mjs';

function evidence(secrets: string[] = []) {
	return createAcceptanceEvidence({ harness: 'delivery-v1', secrets });
}

/** An object key, as the storage layer writes one. Refused everywhere below. */
const AN_OBJECT_KEY = 'canonical/8f2b1c4d9e7a6b5c4d3e2f1a0b9c8d7e';
/** This checkout's own absolute path — the thing a printed stack trace discloses. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Run one harness to completion and read everything it printed.
 *
 * `process.exitCode` is restored because a harness sets it on failure, and a
 * suite that left it set would report its own success as an exit 1.
 */
async function observeHarness(invoke: () => Promise<void>) {
	const exitCodeBefore = process.exitCode;
	const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	// Spying twice in one test returns the same spy with the earlier run's calls
	// still on it, and a read of "everything printed" would then be a read of two
	// runs at once.
	stdout.mockClear();
	stderr.mockClear();
	try {
		await invoke();
		return {
			exitCode: process.exitCode,
			stdout: stdout.mock.calls.map(call => String(call[0])).join(''),
			stderr: stderr.mock.calls.map(call => String(call[0])).join(''),
		};
	}
	finally {
		process.exitCode = exitCodeBefore;
	}
}

describe('graphics staging acceptance evidence', () => {
	it('reports one stable code and the observed mismatch per failure', () => {
		expect(evidence().report([
			{ code: 'delivery-status-unexpected', detail: { expected: 200, actual: 503 } },
			{ code: 'delivery-validator-not-strong', detail: { shape: 'weak' } },
		])).toBe(
			'delivery-v1 delivery-status-unexpected expected=200 actual=503\n'
			+ 'delivery-v1 delivery-validator-not-strong shape=weak',
		);
	});

	it('refuses a code outside the stable registry', () => {
		expect(() => evidence().report([{ code: 'delivery-went-wrong', detail: {} }]))
			.toThrow('delivery-v1 evidence-unknown-code');
	});

	it('refuses to print a registered secret', () => {
		const capability = 'PN7yQ0hVn3wKq2ZLb8sVdT1cRj4mXaGe9uFhBzYo0Ss';
		expect(() => evidence([capability]).report([
			{ code: 'delivery-authorization-skipped', detail: { capability } },
		])).toThrow('delivery-v1 evidence-secret-leak field=capability');
	});

	it('refuses to print a full delivery URL', () => {
		expect(() => evidence().report([{
			code: 'delivery-status-unexpected',
			detail: { route: 'https://stream.example.workers.dev/api/screen-output/screens/1' },
		}])).toThrow('delivery-v1 evidence-url-leak field=route');
	});

	it('refuses to print a source filename or object key', () => {
		expect(() => evidence().report([
			{ code: 'delivery-body-mismatch', detail: { source: 'sponsor-logo.png' } },
		])).toThrow('delivery-v1 evidence-filename-leak field=source');
		expect(() => evidence().report([
			{ code: 'delivery-body-mismatch', detail: { key: 'canonical/8f2b1c4d9e7a6b5c4d3e2f1a0b9c8d7e' } },
		])).toThrow('delivery-v1 evidence-opaque-token-leak field=key');
	});

	it('refuses a detail value too long to read at a glance', () => {
		expect(() => evidence().report([
			{ code: 'delivery-status-unexpected', detail: { note: 'x '.repeat(80) } },
		])).toThrow('delivery-v1 evidence-detail-too-long field=note');
	});

	it('keeps route labels, header values, and counts', () => {
		expect(evidence().report([{
			code: 'delivery-content-range-unexpected',
			detail: {
				route: deliveryRouteLabel(
					'https://stream.example.workers.dev/api/screen-output/screens/12/assets/gaa-1/revisions/gar-9/content',
				),
				expected: 'bytes 8-15/95',
				actual: 'bytes 0-94/95',
			},
		}])).toBe(
			'delivery-v1 delivery-content-range-unexpected '
			+ 'route=/api/screen-output/screens/:screenId/assets/:assetId/revisions/:revisionId/content '
			+ 'expected=bytes 8-15/95 actual=bytes 0-94/95',
		);
	});

	it('reduces the editor content route to the same identifier-free label', () => {
		expect(deliveryRouteLabel('/api/graphics-assets/gaa-1/revisions/gar-9/content'))
			.toBe('/api/graphics-assets/:assetId/revisions/:revisionId/content');
	});

	it('labels a route it was not written for without echoing its identifiers', () => {
		expect(deliveryRouteLabel('https://stream.example.workers.dev/api/graphics-assets/gaa-1/thumbnail'))
			.toBe('/api/graphics-assets/:assetId/thumbnail');
		expect(deliveryRouteLabel('/api/graphics-assets/installed-templates/tpl-77'))
			.toBe('/api/graphics-assets/installed-templates/:templateId');
		expect(deliveryRouteLabel('/event/12/screen/acceptance-overlay-9f2c'))
			.toBe('/event/:eventId/screen/:screenSlug');
	});

	it('withholds a segment it does not recognise rather than guessing it is a route word', () => {
		expect(deliveryRouteLabel('/api/some-future-collection/0d5f5d2e-4a11-4d4f-9a2a-6b2f1c3d4e5f'))
			.toBe('/api/:id/:id');
	});

	it('refuses a raw request path even when it is handed one as detail', () => {
		expect(() => evidence().report([{
			code: 'harness-precondition-unmet',
			detail: { route: '/api/graphics-assets/0d5f5d2e4a114d4f9a2a/revisions/gar-9/content' },
		}])).toThrow('delivery-v1 evidence-opaque-token-leak field=route');
	});

	it('publishes every code it will ever print', () => {
		expect(ACCEPTANCE_FAILURE_CODES).toContain('delivery-revocation-ineffective');
		expect(new Set(ACCEPTANCE_FAILURE_CODES).size).toBe(ACCEPTANCE_FAILURE_CODES.length);
		expect([...ACCEPTANCE_FAILURE_CODES].every(code => /^[a-z][a-z0-9-]*$/.test(code))).toBe(true);
	});

	it('summarises a passing run without an origin-bearing URL', () => {
		expect(evidence().passed({ checks: 24, mode: 'local' }))
			.toBe('delivery-v1 acceptance passed checks=24 mode=local');
	});

	it('never calls an unobserved check a pass', () => {
		expect(evidence().deferred({ path: 'manual-check-required' }))
			.toBe('delivery-v1 acceptance deferred path=manual-check-required');
	});

	/**
	 * An environment-variable name is thirty-five word characters and was read as
	 * an opaque token, so the one failure whose whole job is to tell an operator
	 * which name to set could not be printed at all (#275).
	 */
	it('keeps an environment-variable name, which is words rather than a token', () => {
		expect(evidence().report([{
			code: 'harness-precondition-unmet',
			detail: { reason: 'STREAM_KEEPR_BROWSER_ACCEPTANCE_URL is unset' },
		}])).toBe(
			'delivery-v1 harness-precondition-unmet '
			+ 'reason=STREAM_KEEPR_BROWSER_ACCEPTANCE_URL is unset',
		);
	});

	/**
	 * Both halves of the narrowing, because an underscore is only a word
	 * separator in a name built of upper-case words. A base64url capability
	 * containing one is still a capability, and a long upper-case run does not
	 * become vocabulary by acquiring a prefix.
	 */
	it('still refuses a token that merely contains an underscore', () => {
		expect(() => evidence().report([
			{ code: 'delivery-body-mismatch', detail: { key: 'PN7yQ0hVn3wKq2_Lb8sVdT1cRj4mXaGe9uFhBzYo0Ss' } },
		])).toThrow('delivery-v1 evidence-opaque-token-leak field=key');
		expect(() => evidence().report([
			{ code: 'delivery-body-mismatch', detail: { key: 'REVISION_8F2B1C4D9E7A6B5C4D3E2F1A0B9C8D7E' } },
		])).toThrow('delivery-v1 evidence-opaque-token-leak field=key');
	});
});

/**
 * The reporting path is the last thing a harness does and sits outside the
 * `try` that wraps the run, so a refusal raised there escaped as a raw Node
 * error and printed the absolute path of every frame in its stack — the
 * disclosure this module exists to prevent, arriving through this module
 * (#275).
 */
describe('a harness printing evidence it cannot format', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	/**
	 * The ticket's own reproduction: `pnpm test:delivery:graphics:deployed` with
	 * no URL set. Both halves have to hold for this to pass — the reason has to
	 * survive the opacity rule, and the reporting has to survive a reason that
	 * does not.
	 */
	it('answers a --deployed run with no URL with its stable code, not a stack trace', async () => {
		vi.stubEnv('STREAM_KEEPR_BROWSER_ACCEPTANCE_URL', undefined);
		vi.stubEnv('STREAM_KEEPR_DEPLOY_HEALTH_URL', undefined);

		const observed = await observeHarness(() => runAcceptanceHarness({
			harness: 'graphics-delivery-v1',
			run: async () => {
				acceptanceOrigin({ deployed: true });
			},
		}));

		expect(observed.stderr).toBe(
			'graphics-delivery-v1 acceptance failed:\n'
			+ 'graphics-delivery-v1 harness-precondition-unmet '
			+ 'reason=STREAM_KEEPR_BROWSER_ACCEPTANCE_URL is unset\n',
		);
		expect(observed.stdout).toBe('');
		expect(observed.exitCode).toBe(1);
		expect(observed.stderr).not.toContain(REPOSITORY_ROOT);
		expect(observed.stderr).not.toContain('.mjs');
	});

	it('degrades a refused failure to its stable codes instead of dying in the reporting', async () => {
		const observed = await observeHarness(() => runAcceptanceHarness({
			harness: 'delivery-v1',
			run: async ({ record }) => {
				record([
					{ code: 'delivery-body-mismatch', detail: { key: AN_OBJECT_KEY } },
					{ code: 'delivery-status-unexpected', detail: { expected: 200, actual: 503 } },
				]);
			},
		}));

		expect(observed.stderr).toBe(
			'delivery-v1 acceptance failed:\n'
			+ 'delivery-v1 delivery-body-mismatch detail=withheld\n'
			+ 'delivery-v1 delivery-status-unexpected detail=withheld\n'
			+ 'delivery-v1 evidence-opaque-token-leak field=key\n',
		);
		expect(observed.exitCode).toBe(1);
		expect(observed.stderr).not.toContain(AN_OBJECT_KEY);
		expect(observed.stderr).not.toContain(REPOSITORY_ROOT);
	});

	/**
	 * A browser verdict names its own code and that name is untrusted page text
	 * (`chromium.mjs`), so the degraded line may not echo it: the fallback for a
	 * leak may not be a second leak.
	 */
	it('does not echo a code the registry never published', async () => {
		const observed = await observeHarness(() => runAcceptanceHarness({
			harness: 'static-font-v1',
			run: async ({ record }) => {
				record([{ code: 'https://attacker.example/?stolen=1', detail: { page: 'static-font-v1' } }]);
			},
		}));

		expect(observed.stderr).toBe(
			'static-font-v1 acceptance failed:\n'
			+ 'static-font-v1 evidence-unknown-code detail=withheld\n'
			+ 'static-font-v1 evidence-unknown-code\n',
		);
		expect(observed.exitCode).toBe(1);
		expect(observed.stderr).not.toContain('attacker.example');
	});

	/**
	 * A leak is itself a failure, so a run whose closing line is refused has not
	 * been observed to pass — the summary path may not be the way a pass gets
	 * printed for a run nobody could read the evidence of.
	 */
	it('does not call a run passed when its own summary is refused', async () => {
		const observed = await observeHarness(() => runAcceptanceHarness({
			harness: 'delivery-v1',
			run: async () => ({ key: AN_OBJECT_KEY }),
		}));

		expect(observed.stdout).toBe('');
		expect(observed.stderr).toBe(
			'delivery-v1 acceptance failed:\n'
			+ 'delivery-v1 evidence-opaque-token-leak field=key\n',
		);
		expect(observed.exitCode).toBe(1);
	});

	/**
	 * The fallback may not become the leak. Anything reaching it that is not the
	 * formatter talking has an unknown message — a Node error's carries the path
	 * it was raised from — so only a message in the formatter's own shape is
	 * printed, and everything else is reduced to the fact that a line could not
	 * be built.
	 */
	it('does not echo an error that is not the formatter refusing a field', async () => {
		const observed = await observeHarness(() => runAcceptanceHarness({
			harness: 'delivery-v1',
			run: async () => ({
				get checked() {
					throw new Error(`ENOENT: no such file or directory, open '${REPOSITORY_ROOT}secret.txt'`);
				},
			}),
		}));

		expect(observed.stdout).toBe('');
		expect(observed.stderr).toBe(
			'delivery-v1 acceptance failed:\n'
			+ 'delivery-v1 evidence-report-refused\n',
		);
		expect(observed.exitCode).toBe(1);
		expect(observed.stderr).not.toContain(REPOSITORY_ROOT);
	});

	it('still prints an ordinary pass, and a deferral under its instructions', async () => {
		const passed = await observeHarness(() => runAcceptanceHarness({
			harness: 'delivery-v1',
			run: async ({ record }) => {
				record([]);
				return { mode: 'local' };
			},
		}));
		expect(passed.stdout).toBe('delivery-v1 acceptance passed checks=1 mode=local\n');
		expect(passed.stderr).toBe('');

		const deferred = await observeHarness(() => runAcceptanceHarness({
			harness: 'delivery-v1',
			run: async ({ defer }) => {
				defer({ path: 'manual-check-required' }, 'Observe this by hand.');
			},
		}));
		expect(deferred.stdout).toBe(
			'Observe this by hand.\n'
			+ 'delivery-v1 acceptance deferred path=manual-check-required\n',
		);
		expect(deferred.stderr).toBe('');
	});
});
