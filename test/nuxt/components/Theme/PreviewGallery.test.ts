import type { VueWrapper } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_PREVIEW_SCREEN_MODES } from '~~/shared/screenModes';
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

/** Card Spotlight's Card, shown once its image has loaded. */
function spotlightCard(gallery: VueWrapper) {
	return tile(gallery, 'card').find('[data-testid="spotlight-card"] img');
}

describe('the Theme preview gallery', () => {
	it('shows every Screen Mode a Theme preview shows, in Screen Mode order', () => {
		const shown = mountGallery().findAll('[data-preview-mode]').map(tile => tile.attributes('data-preview-mode'));

		expect(shown).toEqual(THEME_PREVIEW_SCREEN_MODES);
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
			mode: 'card',
			tokens: { 'card.card-width': 300 },
			shown: (gallery: VueWrapper) => spotlightCard(gallery).exists(),
			painted: (gallery: VueWrapper) => (tile(gallery, 'card').get('.screen-renderer').element as HTMLElement).style.getPropertyValue('--theme-card-card-width'),
			value: '300px',
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
