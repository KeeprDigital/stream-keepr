import type { VueWrapper } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { settleUntil } from '~~/test/helpers/settle';
import PreviewGallery from '~/components/Theme/PreviewGallery.vue';

// The Theme editor's gallery shows every Screen Mode that declares Mode Tokens,
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

describe('the Theme preview gallery', () => {
	it('shows every Screen Mode that declares Mode Tokens, and only those', () => {
		const themed = SCREEN_MODE_VALUES.filter(mode => SCREEN_MODES[mode].modeTokens);

		const shown = mountGallery().findAll('[data-preview-mode]').map(tile => tile.attributes('data-preview-mode'));

		expect(shown).toEqual(themed);
	});

	it('repaints as the Theme\'s tokens change', async () => {
		const gallery = mountGallery();
		await settleUntil(() => gallery.find('.standings-table').exists());

		await gallery.setProps({
			tokens: { surface: 'rgb(9, 8, 7)' },
		});

		expect(getComputedStyle(gallery.get('.standings-table').element).backgroundColor).toBe('rgb(9, 8, 7)');
	});
});
