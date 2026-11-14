import type { VueWrapper } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { eventKind, isOfferedToEvent } from '~~/shared/config/games';
import { featureMatchSampleDataset } from '~~/shared/featureMatchSampleDataset';
import { SCREEN_MODES, THEME_PREVIEW_SCREEN_MODES } from '~~/shared/screenModes';
import { settleUntil } from '~~/test/helpers/settle';
import { loadDrawnImages } from '~~/test/nuxt/helpers/drawnImages';
import PreviewGallery from '~/components/Theme/PreviewGallery.vue';

// The Theme editor's gallery shows every Screen Mode a Theme preview shows,
// read off its definition, under the Theme as it stands.

let wrapper: VueWrapper | undefined;

afterEach(() => {
	wrapper?.unmount();
	wrapper = undefined;
});

function mountGallery() {
	wrapper = mount(PreviewGallery, {
		props: { tokens: {} },
		global: {
			stubs: { MtgManaColorDisplay: true },
		},
		attachTo: document.body,
	});
	return wrapper;
}

function tile(gallery: VueWrapper, mode: string) {
	return gallery.get(`[data-preview-mode="${mode}"]`);
}

/** The sample lower third's name, as the compositor paints it. */
function lowerThirdName(gallery: VueWrapper) {
	return tile(gallery, 'broadcast-graphics').findAll('p').find(text => text.text() === 'Alexandra Whitfield-Moreau');
}

describe('the Theme preview gallery', () => {
	// A Theme serves Events of either Card Game, so its preview shows the one picked, Magic first.
	it.each([
		{ game: 'mtg', pick: false },
		{ game: 'mtg', pick: true },
		{ game: 'op', pick: true },
	] as const)('shows every $game Screen Mode a Theme preview shows, in Screen Mode order (picked: $pick)', async ({ game, pick }) => {
		const gallery = mountGallery();
		if (pick)
			await gallery.get(`[data-testid="tab-${game}"]`).trigger('click');

		const tiles = gallery.findAll('[data-preview-mode]');

		expect(tiles.map(tile => tile.attributes('data-preview-mode')))
			.toEqual(THEME_PREVIEW_SCREEN_MODES.filter(mode => isOfferedToEvent(SCREEN_MODES[mode].offeredTo, eventKind({ game }))));
		expect(new Set(tiles.map(tile => tile.attributes('data-preview-game')))).toEqual(new Set([game]));
	});

	// A Commander Event is a pick beside the Card Games: its Feature Match Overlay seats four (ADR-0087).
	it('shows a Commander Event\'s Screen Modes, its Feature Match Overlay seating the Commander sample\'s four', async () => {
		const gallery = mountGallery();
		await gallery.get('[data-testid="tab-commander"]').trigger('click');

		expect(gallery.findAll('[data-preview-mode]').map(found => found.attributes('data-preview-mode')))
			.toEqual(THEME_PREVIEW_SCREEN_MODES.filter(mode => isOfferedToEvent(SCREEN_MODES[mode].offeredTo, 'mtg-commander')));
		const { player1Name, player4Name } = featureMatchSampleDataset('mtg-commander').tokenValues;
		await settleUntil(() => tile(gallery, 'feature-match-overlay').text().includes(String(player4Name)));
		expect(tile(gallery, 'feature-match-overlay').text()).toContain(String(player1Name));
	});

	it.each([
		{
			mode: 'standings',
			tokens: { surface: 'rgb(9, 8, 7)' },
			shown: (gallery: VueWrapper) => gallery.find('.standings-table').exists(),
			painted: (gallery: VueWrapper) => getComputedStyle(gallery.get('.standings-table').element).backgroundColor,
			value: 'rgb(9, 8, 7)',
		},
		{
			mode: 'broadcast-graphics',
			tokens: { 'text-primary': 'rgb(1, 2, 3)' },
			shown: (gallery: VueWrapper) => lowerThirdName(gallery) !== undefined,
			painted: (gallery: VueWrapper) => (lowerThirdName(gallery)!.element as HTMLElement).style.color,
			value: 'rgb(1, 2, 3)',
		},
	])('shows $mode from the sample and repaints it as the Theme\'s tokens change', async ({ tokens, shown, painted, value }) => {
		const gallery = mountGallery();
		await settleUntil(() => {
			loadDrawnImages(gallery);
			return shown(gallery);
		});

		await gallery.setProps({ tokens });

		expect(shown(gallery)).toBe(true);
		expect(painted(gallery)).toBe(value);
	});
});
