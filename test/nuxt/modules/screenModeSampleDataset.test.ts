import type { VueWrapper } from '@vue/test-utils';
import type { Game, ScreenMode } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOfferedToCardGame } from '~~/shared/config/games';
import { BACKGROUND_LAYERS_CAPABLE_MODES, SCREEN_MODES, THEME_PREVIEW_SCREEN_MODES } from '~~/shared/screenModes';
import { settleUntil } from '~~/test/helpers/settle';
import { loadDrawnImages } from '~~/test/nuxt/helpers/drawnImages';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import PreviewTile from '~/components/Theme/PreviewTile.vue';

// Each Card Game's Screen Mode Sample Dataset fills every plain overlay mode and
// every mode a Theme preview shows that its Events are offered, so a mode themed
// later previews with no change to it, and it fills them alone: a preview makes
// no request, not even for card data.

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

const opCard = (number: string): Shown => rendering => rendering.find(`[data-testid="op-deck-card"][data-number="${number}"] img`).exists();

/** What each mode shows of each Card Game's sample, where its defaults alone would show nothing. */
const SHOWS: Record<Game, Partial<Record<ScreenMode, Shown>>> = {
	op: {
		'card': rendering => rendering.find('[data-testid="spotlight-card"] img[src="https://cards-img.keepr.digital/OP05-119_p1.png"]').exists(),
		'deck': rendering => opCard('OP09-080')(rendering)
			&& rendering.find('[data-testid="op-deck-leader"][data-number="OP05-060"]').exists()
			&& text('Sebastián Castellanos-Ruiz')(rendering),
		'broadcast-graphics': text('Monkey.D.Luffy · Purple'),
		'feature-match-overlay': text('Enel'),
	},
	mtg: {
		'card': rendering => rendering.find('[data-testid="spotlight-card"] img').exists(),
		'standings': text('Alexandra Whitfield-Moreau'),
		'deck': deckCard('Gleeful Demolition'),
		'top-cut': text('Tomás Ó Briain'),
		'broadcast-graphics': text('Boros Convoke · 6-0-1'),
		'feature-match-overlay': text('Dimir Midrange'),
		'metagame': text('Mono-Green Landfall'),
		'top-cards': text('Lightning Helix'),
		'player-history': text('Maximilian Hohenberger'),
		'pairings': text('Ana Lúcia Ferreira'),
		'archetype-spotlight': text('Jo Lee'),
		'head-to-head': text('Kenji Sato'),
	},
};

const MODES = [
	...new Set([
		...BACKGROUND_LAYERS_CAPABLE_MODES,
		...THEME_PREVIEW_SCREEN_MODES,
	]),
];

const CASES = (['mtg', 'op'] as const).flatMap(game => MODES
	.filter(mode => isOfferedToCardGame(SCREEN_MODES[mode].cardGames, game))
	.map(mode => ({ game, mode })));

describe('the Screen Mode Sample Dataset', () => {
	it.each(CASES)('fills the $game $mode display with no request', async ({ game, mode }) => {
		const shows = SHOWS[game][mode];
		expect(shows, `name what ${mode} shows of the ${game} sample`).toBeDefined();
		// One Piece cards are Printing images, loaded off-DOM before they show.
		if (game === 'op')
			stubImageLoading();
		wrapper = mount(PreviewTile, {
			props: {
				mode,
				game,
				label: SCREEN_MODES[mode].label,
				tokens: {},
			},
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
