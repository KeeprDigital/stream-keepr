import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { screenModeTokenName } from '~~/shared/screenModes';
import { standingsModeTokens } from '~~/shared/screenModeTokens/standings';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { fakeScreenThemeNetwork, overrideWrites, ScreenSettingsCardStub, seedThemedScreen } from '~~/test/nuxt/helpers/screenThemeOverrides';
import ThemeTokenGroup from '~/components/Screen/ThemeTokenGroup.vue';
import ThemeTokensSettings from '~/components/Screen/ThemeTokensSettings.vue';

// The residual Screen-wide look holds every token the Screen may override that
// no mounted Screen Settings Group renders, less the host's own placement
// tokens. It starts closed unless it holds an override.

const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockApiFetch);

enableAutoUnmount(afterEach);

beforeEach(() => {
	fakeScreenThemeNetwork(mockApiFetch);
});

/** Mount the residual card, after the Screen Settings Groups `groups` names, under a page registry. */
async function mountSection(mode: ScreenMode, themeOverrides: StoredThemeTokens = {}, groups: string[] = []) {
	const screen = seedThemedScreen(mode, themeOverrides);
	const Page = defineComponent(() => {
		provideScreenSettingsGroups();
		return () => h('div', [
			...groups.map(group => h(ThemeTokenGroup, {
				screen: screen(),
				eventId: 1,
				group,
			})),
			h(ThemeTokensSettings, {
				screen: screen(),
				eventId: 1,
			}),
		]);
	});
	const wrapper = mount(Page, {
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
	it('lists the mode\'s Mode Tokens and the Foundation Tokens their defaults name, but not the Screen inset or alignment', async () => {
		const declared = Object.entries(standingsModeTokens);
		const named = new Set<string>(declared.flatMap(([, { default: fallback }]) => typeof fallback === 'object' && 'token' in fallback
			? [fallback.token]
			: []));

		const wrapper = await mountSection('standings');

		expect(card(wrapper).attributes('data-settings-card')).toBe('Screen-wide look');
		expect(residualRows(wrapper).sort()).toEqual([
			...declared.map(([token]) => screenModeTokenName('standings', token)),
			...Object.keys(FOUNDATION_TOKENS).filter(name => named.has(name)),
		].sort());
	});

	it('leaves out the Mode Tokens a mounted Screen Settings Group renders', async () => {
		const wrapper = await mountSection('standings', {}, ['header']);

		const inGroup = wrapper.get('[data-settings-group="header"]').findAll('[data-token]').map(row => row.attributes('data-token'));
		expect(inGroup).toEqual(['standings.title-typography', 'standings.title-text', 'standings.title-divider']);
		expect(residualRows(wrapper)).not.toEqual(expect.arrayContaining([
			expect.stringMatching(/^standings\.title-/),
		]));
		expect(residualRows(wrapper)).toContain('standings.surface');
	});

	it.each([
		['closed with nothing overridden', {}, false],
		[
			'open with a Foundation Token overridden',
			{ divider: '#ff0000' },
			true,
		],
		[
			'open with an override of a Mode Token whose group is not mounted',
			{ 'standings.surface': '#ff0000' },
			true,
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
});
