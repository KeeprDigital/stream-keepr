import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';

/** What each Screen's outputs report of themselves through presence. */
const mockScreenPresence = {
	value: new Map<number, { count: number; members: Array<{ data?: { cardData?: string } }> }>(),
};
mockNuxtImport('useScreenStore', () => () => ({ screenPresence: mockScreenPresence.value }));

describe('useScreenOutputCardDataHealth', () => {
	beforeEach(() => {
		mockScreenPresence.value = new Map();
	});

	it('counts only the outputs reporting degraded card data', () => {
		mockScreenPresence.value.set(7, {
			count: 3,
			members: [
				{ data: { cardData: 'degraded' } },
				{ data: { cardData: 'complete' } },
				{ data: { cardData: 'degraded' } },
			],
		});

		expect(useScreenOutputCardDataHealth(7).value).toBe(2);
	});

	it('treats an output reporting nothing as silent, not as degraded', () => {
		mockScreenPresence.value.set(7, {
			count: 2,
			members: [{ data: {} }, {}],
		});

		expect(useScreenOutputCardDataHealth(7).value).toBe(0);
	});

	it('reads zero for a Screen with no presence at all', () => {
		expect(useScreenOutputCardDataHealth(7).value).toBe(0);
	});

	it('scopes the count to the asked-for Screen', () => {
		mockScreenPresence.value.set(7, { count: 1, members: [{ data: { cardData: 'degraded' } }] });
		mockScreenPresence.value.set(8, { count: 1, members: [{ data: { cardData: 'complete' } }] });

		expect(useScreenOutputCardDataHealth(8).value).toBe(0);
	});
});
