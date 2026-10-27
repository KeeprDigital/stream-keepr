import type { VueWrapper } from '@vue/test-utils';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_LAYERS_CAPABLE_MODES, SCREEN_MODES, screenModeTokenName } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import PreviewGallery from '~/components/Theme/PreviewGallery.vue';
import PreviewTile from '~/components/Theme/PreviewTile.vue';

// The Theme editor's gallery shows every themed Screen Mode against the Screen
// Mode Sample Dataset, under the Theme as it stands.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

let wrapper: VueWrapper | undefined;

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	mockFetch.mockReset();
});

async function settle(ready: () => boolean) {
	for (let round = 0; round < 100 && !ready(); round++) {
		await flushPromises();
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

const stubs = { MtgManaColorDisplay: true };

/** What each plain mode shows of the sample, where its defaults alone would show nothing. */
const SHOWS: Partial<Record<ScreenMode, string>> = {
	'standings': 'Alexandra Whitfield-Moreau',
	'deck': 'Gleeful Demolition',
	'top-cut': 'Tomás Ó Briain',
	'metagame': 'Mono-Green Landfall',
	'top-cards': 'Lightning Helix',
	'player-history': 'Maximilian Hohenberger',
	'pairings': 'Ana Lúcia Ferreira',
	'archetype-spotlight': 'Jo Lee',
	'head-to-head': 'Kenji Sato',
};

/** Plain modes the sample cannot fill, and why. */
const NOT_IN_SAMPLE: Partial<Record<ScreenMode, string>> = {
	// Its Card is set live by an operator through the Card store, not read.
	card: 'a Screen Card',
};

describe('the Screen Mode Sample Dataset', () => {
	it.each(BACKGROUND_LAYERS_CAPABLE_MODES.filter(mode => !NOT_IN_SAMPLE[mode]))('fills the %s display, reading no Event Data', async (mode) => {
		expect(SHOWS[mode], `name what ${mode} shows of the sample`).toBeDefined();
		wrapper = mount(PreviewTile, {
			props: { mode, label: SCREEN_MODES[mode].label, tokens: {} },
			global: { stubs },
		});

		await settle(() => wrapper!.text().includes(SHOWS[mode]!));

		expect(wrapper.text()).toContain(SHOWS[mode]);
		// Card data may come from Scryfall, as on any rendering; Event Data never leaves the browser.
		expect(mockFetch.mock.calls.map(([url]) => String(url)).filter(url => !url.startsWith('https://api.scryfall.com/'))).toEqual([]);
	});
});

describe('the Theme preview gallery', () => {
	const themed = SCREEN_MODE_VALUES.filter(mode => Object.keys(SCREEN_MODES[mode].modeTokens ?? {}).length > 0);

	it('shows every Screen Mode that declares Mode Tokens, and only those', () => {
		wrapper = mount(PreviewGallery, {
			props: { tokens: {} },
			global: { stubs },
		});

		const shown = wrapper.findAll('[data-preview-mode]').map(tile => tile.attributes('data-preview-mode'));
		expect(shown).toEqual(themed);
	});

	/** A themed mode's first colour Mode Token, by full name. */
	function colourToken(mode: ScreenMode) {
		const [token] = Object.entries(SCREEN_MODES[mode].modeTokens!).find(([, definition]) => definition.type === 'color')!;
		return screenModeTokenName(mode, token);
	}

	/** The value the tile's Screen host sets for `name`, as its display reads it. */
	function painted(mode: ScreenMode, name: string) {
		const host = wrapper!.get(`[data-preview-mode="${mode}"] .screen-renderer`).element as HTMLElement;
		return host.style.getPropertyValue(`--theme-${name.replace('.', '-')}`);
	}

	it.each(themed)('repaints %s as its Theme\'s tokens change', async (mode) => {
		const name = colourToken(mode);
		const theme = (value: string): StoredThemeTokens => ({ [name]: value });
		wrapper = mount(PreviewGallery, {
			props: {
				tokens: theme('rgb(1, 2, 3)'),
			},
			global: { stubs },
		});
		await flushPromises();
		expect(painted(mode, name)).toBe('rgb(1, 2, 3)');

		await wrapper.setProps({
			tokens: theme('rgb(4, 5, 6)'),
		});

		expect(painted(mode, name)).toBe('rgb(4, 5, 6)');
	});

	it('repaints a Standings table as the Theme\'s surface changes', async () => {
		wrapper = mount(PreviewGallery, {
			props: { tokens: {} },
			global: { stubs },
			attachTo: document.body,
		});
		await settle(() => wrapper!.find('.standings-table').exists());

		await wrapper.setProps({
			tokens: { surface: 'rgb(9, 8, 7)' },
		});

		expect(getComputedStyle(wrapper.get('.standings-table').element).backgroundColor).toBe('rgb(9, 8, 7)');
	});
});
