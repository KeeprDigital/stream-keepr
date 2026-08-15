import { describe, expect, it, vi } from 'vitest';
import { runAcceptanceHarness } from '../../../scripts/graphics-acceptance/harness.mjs';

vi.mock('../../../scripts/graphics-acceptance/harness.mjs', () => ({
	runAcceptanceHarness: vi.fn(),
}));

/**
 * Every `run-*` acceptance script and the harness id it runs under. The
 * silent-video validator is absent deliberately: it drives wrangler directly
 * and never uses the harness, so it has no call site to make inert.
 */
const SCRIPTS = [
	['run-font-browser-acceptance', 'static-font-v1'],
	['run-graphics-delivery-acceptance', 'graphics-delivery-v1'],
	['run-graphics-package-acceptance', 'graphics-package-v1'],
	['run-safari-vp9-alpha-acceptance', 'vp9-alpha-safari-v1'],
	['run-silent-video-browser-acceptance', 'silent-video-v1'],
	['run-still-image-browser-acceptance', 'still-image-v1'],
	['run-still-image-ingestion-acceptance', 'still-image-ingestion-v1'],
] as const;

/**
 * These modules used to run their harness at import — the module's body *was*
 * the run — so importing one in a test opened an installation and drove a
 * browser, and every call site inside a `run` callback was reachable by no
 * unit runner (#345). The exported `main()` is what lifted that: import builds
 * definitions only, and the run starts when `main()` is called — by Node when
 * the module is the entry point, or by a test that has mocked the boundary.
 */
describe('acceptance script entry points', () => {
	it.each(SCRIPTS)('%s is inert at import and runs its harness only through main()', async (script, harness) => {
		const module = await import(`../../../scripts/${script}.mjs`);

		expect(runAcceptanceHarness).not.toHaveBeenCalled();
		expect(module.main).toBeTypeOf('function');

		await module.main(['node', `scripts/${script}.mjs`]);

		expect(runAcceptanceHarness).toHaveBeenCalledTimes(1);
		expect(vi.mocked(runAcceptanceHarness).mock.calls[0]![0]).toMatchObject({
			harness,
			run: expect.any(Function),
		});
	});
});
