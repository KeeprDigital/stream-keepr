import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ScreenThemeNetwork } from '~~/test/nuxt/helpers/screenThemeOverrides';
import type { ScreenThemeOverrides } from '~/composables/screen/useScreenThemeOverrides';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { deferred } from '~~/test/helpers/deferred';
import { createWireMockScreen } from '~~/test/helpers/fixtures';
import { fakeScreenThemeNetwork, overrideWrites, screenSettingsPage, seedThemedScreen, themeReads } from '~~/test/nuxt/helpers/screenThemeOverrides';

// A Screen's settings page holds one instance for all its cards: what each
// token inherits from the Event's Theme, read once for the page, and one
// Screen Theme Override write per edit, shown while the write is out.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

let network: ScreenThemeNetwork;

beforeEach(() => {
	network = fakeScreenThemeNetwork(mockApiFetch);
});

/** A page of two cards over `screen`, and a third once `showLater` is set; answers what each card was handed. */
function mountPage(screen: () => Screen | null) {
	const handed: ScreenThemeOverrides[] = [];
	const showLater = ref(false);
	const Card = defineComponent(() => {
		handed.push(useScreenThemeOverrides());
		return () => null;
	});
	mount(screenSettingsPage(screen, () => [
		h(Card),
		h(Card),
		showLater.value
			? h(Card)
			: null,
	]));
	return { handed, showLater };
}

function setUp(themeOverrides: StoredThemeTokens = {}, mode: ScreenMode = 'standings') {
	return mountPage(seedThemedScreen(mode, themeOverrides)).handed[0]!;
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
			{ positive: '#123456' },
			'standings.rise',
			{ token: 'positive' },
			'#123456',
		],
		// The former stored form: shown as the literal it resolves to, never as stored.
		[
			'a Mode Token whose Theme value names a Foundation Token',
			{
				'accent': '#aa0000',
				'standings.rise': { token: 'accent' },
			},
			'standings.rise',
			'#aa0000',
			'#aa0000',
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

	it('reads a Mode Token resolving to none, as an unset asset does', async () => {
		const overrides = setUp({}, 'feature-match-overlay');
		await flushPromises();

		expect(overrides.entry('feature-match-overlay.frame-media').resolved).toBeNull();
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

	// A group's Look may mount long after the page, as a card opens or a layer is selected.
	it('reads the Event\'s Theme once for every card of the page, one mounting later included', async () => {
		const { handed, showLater } = mountPage(seedThemedScreen('standings'));
		await flushPromises();

		showLater.value = true;
		await flushPromises();

		expect(handed).toHaveLength(3);
		expect(handed.map(overrides => overrides.themeName.value)).toEqual(['Brand', 'Brand', 'Brand']);
		expect(themeReads(mockApiFetch)).toBe(1);
	});

	it('shows a write that is out to every card', async () => {
		const answer = deferred<Screen>();
		network.answerWrite = () => answer.promise;
		const { handed } = mountPage(seedThemedScreen('standings'));
		await flushPromises();

		void handed[0]!.set('divider', '#ff0000');
		await flushPromises();
		expect(handed[1]!.writing.value.has('divider')).toBe(true);

		answer.resolve(createWireMockScreen({
			id: 1,
			currentMode: 'standings',
			themeOverrides: { divider: '#ff0000' },
			stateVersion: 1,
		}) as unknown as Screen);
		await flushPromises();
		expect(handed[1]!.writing.value.has('divider')).toBe(false);
	});

	it('holds no override and writes nothing until the page has loaded its Screen', async () => {
		seedThemedScreen('standings');
		const overrides = mountPage(() => null).handed[0]!;
		await flushPromises();

		await overrides.set('divider', '#ff0000');

		expect(overrides.entry('divider')).toMatchObject({ stored: undefined, resolved: FOUNDATION_TOKENS.divider.default });
		expect(overrideWrites(mockApiFetch)).toEqual([]);
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
