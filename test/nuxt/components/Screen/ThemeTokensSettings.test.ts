import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { standingsModeTokens } from '~~/shared/screenModeTokens/standings';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { fakeScreenThemeNetwork, overrideWrites, screenSettingsPage, ScreenSettingsCardStub, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import ThemeTokensSettings from '~/components/Screen/ThemeTokensSettings.vue';

// The Screen-wide look holds the Foundation Tokens the Screen may override,
// less the host's own placement tokens; a Mode Token sits in its group's Look
// alone. It starts closed unless it holds an override.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

beforeEach(() => {
	fakeScreenThemeNetwork(mockApiFetch);
});

async function mountSection(mode: ScreenMode, themeOverrides: StoredThemeTokens = {}) {
	const screen = seedThemedScreen(mode, themeOverrides);
	const wrapper = mount(screenSettingsPage(screen, () => h(ThemeTokensSettings, {
		screen: screen(),
		eventId: 1,
	})), {
		global: {
			stubs: { ...nuxtUiStubs, ScreenSettingsCard: ScreenSettingsCardStub },
		},
	});
	await flushPromises();
	return wrapper;
}

const card = (wrapper: VueWrapper) => wrapper.get('[data-testid="screen-theme-tokens"]');

const residualRows = (wrapper: VueWrapper) => card(wrapper).findAll('[data-token]').map(row => row.attributes('data-token'));

describe('the Screen-wide look', () => {
	// A Mode Token renders in its group's Look whether or not that group is on the page, never here.
	it('lists the Foundation Tokens the mode\'s Mode Tokens name by default, and no Mode Token, Screen inset or alignment', async () => {
		const named = new Set<string>(Object.values(standingsModeTokens).flatMap(({ default: fallback }) => typeof fallback === 'object' && 'token' in fallback
			? [fallback.token]
			: []));

		const wrapper = await mountSection('standings');

		expect(card(wrapper).attributes('data-settings-card')).toBe('Screen-wide look');
		expect(residualRows(wrapper)).toEqual(Object.keys(FOUNDATION_TOKENS).filter(name => named.has(name)));
	});

	it.each([
		['closed with nothing overridden', {}, false],
		[
			'open with a Foundation Token overridden',
			{ divider: '#ff0000' },
			true,
		],
		[
			'closed with only a Mode Token overridden',
			{ 'standings.surface': '#ff0000' },
			false,
		],
		[
			'closed with only the Screen inset overridden',
			{ inset: 40 },
			false,
		],
	])('starts %s', async (_case, overrides, opened) => {
		const wrapper = await mountSection('standings', overrides);

		expect(card(wrapper).attributes('data-default-open')).toBe(String(opened));
	});

	it('shows nothing for a mode that consumes no Theme Token', async () => {
		const wrapper = await mountSection('feature-match');

		expect(wrapper.find('[data-testid="screen-theme-tokens"]').exists()).toBe(false);
	});

	// A graphics host's Graphic Items may bind any of them, so its Screen may override any (#831).
	it('lists every Foundation Token a Graphic Item may bind on a graphics host', async () => {
		const wrapper = await mountSection('broadcast-graphics');

		expect(residualRows(wrapper)).toEqual(expect.arrayContaining([
			'accent',
			'logo',
			'heading',
			'panel',
			'motion-enter',
		]));
		// No binding slot takes a dimension or a Background Layer stack.
		expect(residualRows(wrapper)).not.toContain('inset');
		expect(residualRows(wrapper)).not.toContain('background');
	});

	it('clears a row\'s override as one write', async () => {
		const wrapper = await mountSection('standings', { divider: '#ff0000' });

		await card(wrapper).get('[data-token="divider"]').findAll('button').find(button => button.text() === 'Clear')!.trigger('click');
		await flushPromises();

		expect(overrideWrites(mockApiFetch)).toEqual([
			{ divider: null },
		]);
	});

	// Each override write announces `screen:updated`, so a drag writes once, on close.
	it('writes a colour override once its picker closes, carrying its alpha', async () => {
		const wrapper = await mountSection('standings');
		const row = card(wrapper).get('[data-token="divider"]');

		await row.get('[data-token-part="colour"]').trigger('click');
		await row.get('[data-color-part="hue"]').setValue('#00ff00');
		await row.get('[data-color-part="hue"]').setValue('#ff0000');
		await row.get('[data-color-part="alpha"]').setValue(40);
		await flushPromises();
		expect(overrideWrites(mockApiFetch)).toEqual([]);

		await row.get('[data-token-part="colour"]').trigger('click');
		await flushPromises();
		expect(overrideWrites(mockApiFetch)).toEqual([
			{ divider: 'rgba(255, 0, 0, 0.4)' },
		]);
	});
});
