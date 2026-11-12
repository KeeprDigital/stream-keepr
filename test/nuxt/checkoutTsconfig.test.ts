import { expect, it } from 'vitest';

// Wiring: the Nuxt suite's Vite server is told the checkout's tsconfig (`vite.tsconfig`,
// nuxt.config.ts), as the unit suite's is (test/unit/build/checkoutTsconfig.test.ts).
it('the Nuxt suite transforms a module without opening the tsconfig beside it', async () => {
	await expect(import('../helpers/unloadableTsconfig/module.ts')).resolves.toHaveProperty('answer', 42);
});
