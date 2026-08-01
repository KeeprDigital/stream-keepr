import { describe, expect, it } from 'vitest';
import {
	ACCEPTANCE_FAILURE_CODES,
	createAcceptanceEvidence,
	deliveryRouteLabel,
} from '../../../scripts/graphics-acceptance/evidence.mjs';

function evidence(secrets: string[] = []) {
	return createAcceptanceEvidence({ harness: 'delivery-v1', secrets });
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
});
