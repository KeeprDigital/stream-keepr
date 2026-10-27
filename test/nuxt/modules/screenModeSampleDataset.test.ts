import type { VueWrapper } from '@vue/test-utils';
import type { ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_LAYERS_CAPABLE_MODES, SCREEN_MODES, THEME_PREVIEW_SCREEN_MODES } from '~~/shared/screenModes';
import { settleUntil } from '~~/test/helpers/settle';
import { loadDrawnImages } from '~~/test/nuxt/helpers/drawnImages';
import PreviewTile from '~/components/Theme/PreviewTile.vue';

// The Screen Mode Sample Dataset fills every plain overlay mode and every mode
// a Theme preview shows, so a mode themed later previews with no change to it,
// and it fills them alone: a preview makes no request, not even for card data.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
const browserFetch = vi.fn();

let wrapper: VueWrapper | undefined;

beforeEach(() => {
	vi.stubGlobal('fetch', browserFetch);
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
	mockFetch.mockReset();
	browserFetch.mockReset();
	vi.unstubAllGlobals();
});

type Shown = (rendering: VueWrapper) => boolean;
const text = (shown: string): Shown => rendering => rendering.text().includes(shown);
const deckCard = (name: string): Shown => rendering => rendering.find(`img[alt="${name}"]`).exists();

/** What each mode shows of the sample, where its defaults alone would show nothing. */
const SHOWS: Partial<Record<ScreenMode, Shown>> = {
	'card': rendering => rendering.find('[data-testid="spotlight-card"] img').exists(),
	'standings': text('Alexandra Whitfield-Moreau'),
	'deck': deckCard('Gleeful Demolition'),
	'top-cut': text('Tomás Ó Briain'),
	'broadcast-graphics': text('Boros Convoke · 6-0-1'),
	'metagame': text('Mono-Green Landfall'),
	'top-cards': text('Lightning Helix'),
	'player-history': text('Maximilian Hohenberger'),
	'pairings': text('Ana Lúcia Ferreira'),
	'archetype-spotlight': text('Jo Lee'),
	'head-to-head': text('Kenji Sato'),
};

const MODES = [
	...new Set([
		...BACKGROUND_LAYERS_CAPABLE_MODES,
		...THEME_PREVIEW_SCREEN_MODES,
	]),
];

describe('the Screen Mode Sample Dataset', () => {
	it.each(MODES)('fills the %s display with no request', async (mode) => {
		const shows = SHOWS[mode];
		expect(shows, `name what ${mode} shows of the sample`).toBeDefined();
		wrapper = mount(PreviewTile, {
			props: { mode, label: SCREEN_MODES[mode].label, tokens: {} },
			global: {
				stubs: { MtgManaColorDisplay: true },
			},
		});

		await settleUntil(() => {
			loadDrawnImages(wrapper!);
			return shows!(wrapper!);
		});

		expect(shows!(wrapper)).toBe(true);
		expect([
			...mockFetch.mock.calls,
			...browserFetch.mock.calls,
		].map(([url]) => String(url))).toEqual([]);
	});
});
