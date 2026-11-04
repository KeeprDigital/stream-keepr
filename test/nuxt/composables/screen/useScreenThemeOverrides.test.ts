import type { EffectScope } from 'vue';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenThemeNetwork } from '~~/test/nuxt/helpers/screenThemeOverrides';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { deferred } from '~~/test/helpers/deferred';
import { createWireMockScreen } from '~~/test/helpers/fixtures';
import { fakeScreenThemeNetwork, overrideWrites, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';

// A Screen's Theme Token rows read what each token inherits from the Event's
// Theme, loaded once however many rows ask, and write one Screen Theme
// Override per edit, shown while the write is out.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

let network: ScreenThemeNetwork;
let scope: EffectScope;

beforeEach(() => {
	network = fakeScreenThemeNetwork(mockApiFetch);
	scope = effectScope();
});

afterEach(() => scope.stop());

function setUp(themeOverrides: StoredThemeTokens = {}) {
	const screen = seedThemedScreen('standings', themeOverrides);
	return scope.run(() => useScreenThemeOverrides(screen, 1))!;
}

describe('useScreenThemeOverrides', () => {
	it.each([
		[
			'a Foundation Token the Theme leaves unset',
			{},
			'divider',
			FOUNDATION_TOKENS.divider.default,
			FOUNDATION_TOKENS.divider.default,
		],
		[
			'a Foundation Token the Theme sets',
			{ divider: '#123456' },
			'divider',
			'#123456',
			'#123456',
		],
		[
			'a Mode Token following its default',
			{ divider: '#123456' },
			'standings.row-divider',
			{ token: 'divider' },
			'#123456',
		],
		[
			'a Mode Token the Theme points elsewhere',
			{
				'standings.row-divider': { token: 'accent' },
			},
			'standings.row-divider',
			{ token: 'accent' },
			FOUNDATION_TOKENS.accent.default,
		],
	])('reads %s from the Event\'s Theme', async (_case, tokens, name, inherited, resolved) => {
		network.themeTokens = tokens;
		const overrides = setUp();
		await flushPromises();

		expect(overrides.themeName.value).toBe('Brand');
		expect(overrides.entry(name)).toMatchObject({
			name,
			stored: undefined,
			inherited,
			resolved,
		});
	});

	// An unset `asset` Mode Token resolves to null, which is its value, not a miss.
	it('reads a Mode Token resolving to nothing as nothing', async () => {
		const screen = seedThemedScreen('feature-match-overlay');
		const overrides = scope.run(() => useScreenThemeOverrides(screen, 1))!;
		await flushPromises();

		expect(overrides.entry('feature-match-overlay.frame-media')).toMatchObject({ inherited: null, resolved: null });
	});

	it('follows a Theme edit announced after it loaded', async () => {
		const overrides = setUp();
		await flushPromises();

		useEventStore().applyRemoteThemeUpdated({
			eventId: 1,
			theme: {
				id: 'brand',
				revision: 2,
				tokens: { divider: '#654321' },
			},
		} as never);

		expect(overrides.entry('divider').inherited).toBe('#654321');
	});

	it('loads the Event\'s Theme once for every row group asking at the same time', async () => {
		setUp();
		scope.run(() => useScreenThemeOverrides(() => useScreenStore().screens[0]!, 1));
		await flushPromises();

		expect(mockApiFetch.mock.calls.filter(([url]) => url === '/api/themes/brand')).toHaveLength(1);
	});

	it('says when the Event\'s Theme could not be loaded, and reads the Default Theme', async () => {
		mockApiFetch.mockImplementation(async () => {
			throw new Error('offline');
		});
		const overrides = setUp();
		await flushPromises();

		expect(overrides.themeError.value).not.toBeNull();
		expect(overrides.entry('divider').inherited).toBe(FOUNDATION_TOKENS.divider.default);
	});

	it.each([
		['sets', {}, '#ff0000', '#ff0000'],
		[
			'clears',
			{ divider: '#ff0000' },
			null,
			undefined,
		],
	])('%s an override as one write, shown while the write is out', async (_case, stored, value, shown) => {
		const answer = deferred<Screen>();
		network.answerWrite = () => answer.promise;
		const overrides = setUp(stored);
		await flushPromises();

		void (value === null
			? overrides.clear('divider')
			: overrides.set('divider', value));
		await flushPromises();

		expect(overrideWrites(mockApiFetch)).toEqual([
			{ divider: value },
		]);
		expect(overrides.entry('divider').stored).toBe(shown);
		expect(overrides.writing.value.has('divider')).toBe(true);

		answer.resolve(createWireMockScreen({
			id: 1,
			currentMode: 'standings',
			themeOverrides: value === null
				? {}
				: { divider: value },
			stateVersion: 1,
		}) as unknown as Screen);
		await flushPromises();
		expect(overrides.entry('divider').stored).toBe(shown);
		expect(overrides.writing.value.has('divider')).toBe(false);
	});
});
