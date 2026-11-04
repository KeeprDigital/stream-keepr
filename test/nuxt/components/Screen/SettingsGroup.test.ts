import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import SettingsGroup from '~/components/Screen/SettingsGroup.vue';

describe('screenSettingsGroup', () => {
	it('names its content with its heading', () => {
		const wrapper = mount(SettingsGroup, {
			props: { title: 'Rank Badge' },
			slots: {
				default: () => h('input', { 'data-testid': 'field' }),
			},
			global: { stubs: nuxtUiStubs },
		});

		const group = wrapper.get('[role="group"]');
		expect(wrapper.get(`#${group.attributes('aria-labelledby')}`).text()).toBe('Rank Badge');
		expect(group.find('[data-testid="field"]').exists()).toBe(true);
	});
});
