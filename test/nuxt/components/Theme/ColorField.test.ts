import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ThemeColorField from '~/components/Theme/ColorField.vue';

// A composite token's own colour edits alpha and updates once its picker
// closes, so a drag is one token write.

enableAutoUnmount(afterEach);

describe('a composite token\'s colour field', () => {
	it('updates its own colour once the picker closes, carrying its alpha', async () => {
		const wrapper = mount(ThemeColorField, {
			props: { value: '#112233', label: 'Fill colour', alpha: true },
			global: { stubs: nuxtUiStubs },
		});
		const trigger = wrapper.get('[data-token-part="colour"]');

		await trigger.trigger('click');
		await wrapper.get('[data-color-part="hue"]').setValue('#ff0000');
		await wrapper.get('[data-color-part="alpha"]').setValue(30);
		expect(wrapper.emitted('update')).toBeUndefined();

		await trigger.trigger('click');
		expect(wrapper.emitted('update')).toEqual([
			['rgba(255, 0, 0, 0.3)'],
		]);
	});
});
