import type { VueWrapper } from '@vue/test-utils';
import type { ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_LAYERS_CAPABLE_MODES, SCREEN_MODES } from '~~/shared/screenModes';
import { settleUntil } from '~~/test/helpers/settle';
import PreviewTile from '~/components/Theme/PreviewTile.vue';

// The Screen Mode Sample Dataset fills every plain overlay mode a Theme
// preview shows, so a mode themed later previews with no change to it.

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

/** What each plain overlay mode shows of the sample, where its defaults alone would show nothing. */
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

/** Plain overlay modes the sample cannot fill, and why. */
const NOT_IN_SAMPLE: Partial<Record<ScreenMode, string>> = {
	// Its Card is set live by an operator through the Card store, not read.
	card: 'a Screen Card',
};

describe('the Screen Mode Sample Dataset', () => {
	it.each(BACKGROUND_LAYERS_CAPABLE_MODES.filter(mode => !NOT_IN_SAMPLE[mode]))('fills the %s display, reading no Event Data', async (mode) => {
		expect(SHOWS[mode], `name what ${mode} shows of the sample`).toBeDefined();
		wrapper = mount(PreviewTile, {
			props: { mode, label: SCREEN_MODES[mode].label, tokens: {} },
			global: {
				stubs: { MtgManaColorDisplay: true },
			},
		});

		await settleUntil(() => wrapper!.text().includes(SHOWS[mode]!));

		expect(wrapper.text()).toContain(SHOWS[mode]);
		// Card data may come from Scryfall, as on any rendering; Event Data never leaves the browser.
		expect(mockFetch.mock.calls.map(([url]) => String(url)).filter(url => !url.startsWith('https://api.scryfall.com/'))).toEqual([]);
	});
});
