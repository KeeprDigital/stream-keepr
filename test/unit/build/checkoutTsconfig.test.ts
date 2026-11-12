import { join } from 'node:path';
import { transformWithOxc } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKOUT_TSCONFIG } from '../../../build/checkoutTsconfig.ts';
import integrationConfig from '../../../vitest.integration.config.ts';
import localAuthConfig from '../../../vitest.local-auth.config.ts';
import { checkoutInsideOneBeingPrepared } from '../../helpers/checkoutInsideAnother.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const remove of cleanups.splice(0))
		remove();
});

// Left to find a tsconfig, Vite climbs out of the checkout: from an agent's worktree it
// read the main checkout's `.nuxt`, and failed while a `nuxt prepare` there had it cleared.
describe('a Vite server here reads this checkout\'s tsconfig and no other', () => {
	it('the unit suite transforms a module without opening the tsconfig beside it', async () => {
		await expect(import('../../helpers/unloadableTsconfig/module.ts')).resolves.toHaveProperty('answer', 42);
	});

	it.each([
		{ suite: 'integration', config: integrationConfig },
		{ suite: 'local-auth', config: localAuthConfig },
	])('the $suite suite is told which tsconfig is the checkout\'s', ({ config }) => {
		expect(config.tsconfig).toBe(CHECKOUT_TSCONFIG);
	});

	// Vue's plugin is not told: it climbs from the component, and `app/tsconfig.json` is what stops it.
	it('a component\'s script finds its tsconfig inside the checkout', async () => {
		const worktree = checkoutInsideOneBeingPrepared([
			'tsconfig.json',
			'app/tsconfig.json',
			'.nuxt/tsconfig.json',
			'.nuxt/tsconfig.app.json',
		]);
		cleanups.push(worktree.remove);

		const script = await transformWithOxc('export const answer: number = 42;\n', join(worktree.checkout, 'app/components/Probe.vue'), { lang: 'ts' });

		expect(script.code).toContain('export const answer = 42;');
	});
});
