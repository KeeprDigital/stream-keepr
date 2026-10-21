import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundleAnimationEffectPage } from '../../../scripts/graphics-acceptance/animation-effect-proof.mjs';
import { observeChromiumValue, serveAcceptanceRoutes } from '../../../scripts/graphics-acceptance/chromium.mjs';
import { main } from '../../../scripts/run-animation-effect-rendering-acceptance.mjs';

// Only the bundler and the browser are replaced: the harness, the evidence
// formatter and the judging stay real, so these read what a run prints.
vi.mock('../../../scripts/graphics-acceptance/animation-effect-proof.mjs', async importOriginal => ({
	...await importOriginal<object>(),
	bundleAnimationEffectPage: vi.fn(),
}));
vi.mock('../../../scripts/graphics-acceptance/chromium.mjs', async importOriginal => ({
	...await importOriginal<object>(),
	observeChromiumValue: vi.fn(),
	serveAcceptanceRoutes: vi.fn(),
}));

let exitCodeBefore: typeof process.exitCode;

beforeEach(() => {
	exitCodeBefore = process.exitCode;
	vi.mocked(bundleAnimationEffectPage).mockResolvedValue('void 0;');
	vi.mocked(serveAcceptanceRoutes).mockResolvedValue({ origin: 'http://127.0.0.1:5', close: async () => {} });
});

afterEach(() => {
	process.exitCode = exitCodeBefore;
	vi.restoreAllMocks();
});

async function printedFailure() {
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	vi.spyOn(process.stdout, 'write').mockReturnValue(true);
	await main(['node', 'run-animation-effect-rendering-acceptance.mjs']);
	return stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
}

/**
 * `accept:animation-effects` failed twice under load with nothing but
 * `animation-effect-page-failed` (#687). The failure now says what the page
 * threw and what it logged, reduced to what the evidence rules allow.
 */
describe('the animation effect run\'s failure evidence', () => {
	it('names what the page threw while being read, and what it logged', async () => {
		vi.mocked(observeChromiumValue).mockResolvedValue({
			outcome: 'failed',
			detail: 'TypeError: Cannot read properties of null (reading \'dataset\')\n    at <anonymous>:1:15',
			diagnostics: {
				console: ['log: first', 'warning: THREE.WebGLRenderer: Context Lost.', 'error: failed http://127.0.0.1:5/_acceptance/animation-effect-v1.js'],
				uncaught: ['Error: older', 'RangeError: Array buffer allocation failed\n    at captureFrame'],
			},
		});

		const printed = await printedFailure();

		expect(printed).toContain([
			'animation-effect-v1 animation-effect-page-failed page=animation-effect-v1 source=evaluate',
			'thrown=TypeError: Cannot read properties of null (reading \'dataset\')',
			'uncaught=RangeError: Array buffer allocation failed',
			'console1=log: first',
			'console2=warning: THREE.WebGLRenderer: Context Lost.',
			'console3=error: failed <url>',
		].join(' '));
		expect(printed).not.toMatch(/127\.0\.0\.1|detail=withheld/);
		expect(process.exitCode).toBe(1);
	});

	it('carries what the page logged when it gave up measuring and said so in its report', async () => {
		vi.mocked(observeChromiumValue).mockResolvedValue({
			outcome: 'passed',
			value: JSON.stringify({ backend: 'swiftshader', pageFailed: true, pageError: 'RangeError: Array buffer allocation failed\n    at x' }),
			diagnostics: { console: ['error: WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost'], uncaught: [] },
		});

		expect(await printedFailure()).toContain([
			'animation-effect-v1 animation-effect-page-failed source=page thrown=RangeError: Array buffer allocation failed',
			'uncaught=<none> console1=error: WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost',
		].join(' '));
	});

	it('says what the page logged when its report would not parse', async () => {
		vi.mocked(observeChromiumValue).mockResolvedValue({
			outcome: 'passed',
			value: '{"backend":',
			diagnostics: { console: ['log: published'], uncaught: [] },
		});

		expect(await printedFailure()).toContain(
			'animation-effect-v1 animation-effect-page-failed source=report uncaught=<none> console1=log: published',
		);
	});

	it('says what the page logged when it never published anything', async () => {
		vi.mocked(observeChromiumValue).mockResolvedValue({
			outcome: 'timed-out',
			diagnostics: { console: [], uncaught: [] },
		});

		expect(await printedFailure()).toContain(
			'animation-effect-v1 browser-acceptance-timed-out page=animation-effect-v1 uncaught=<none> console1=<none>',
		);
	});
});
