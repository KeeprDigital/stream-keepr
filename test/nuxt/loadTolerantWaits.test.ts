import { expect, it, vi } from 'vitest';

// Wiring: the Nuxt suite loads test/helpers/loadTolerantWaits.ts, so a wait
// outlasts Vitest's own one-second default. The rule is tested at its home,
// test/unit/helpers/loadTolerantWaits.test.ts.
it('a wait outlasts a condition slower than one second', async () => {
	const readyAt = Date.now() + 1_200;

	await vi.waitUntil(() => Date.now() >= readyAt);

	expect(Date.now()).toBeGreaterThanOrEqual(readyAt);
});
