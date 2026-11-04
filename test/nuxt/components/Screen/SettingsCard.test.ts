import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import SettingsCard from '~/components/Screen/SettingsCard.vue';

enableAutoUnmount(afterEach);

function mountCard(props: Record<string, unknown> = {}) {
	return mount(SettingsCard, {
		props: { title: 'Card Badges', ...props },
		slots: {
			default: () => h('input', { 'data-testid': 'field' }),
			actions: ({ open }: { open: boolean }) => h('span', { 'data-testid': 'action' }, open ? 'open' : 'closed'),
		},
		global: { stubs: nuxtUiStubs },
	});
}

function toggle(wrapper: ReturnType<typeof mountCard>) {
	return wrapper.find('button[aria-expanded]');
}

describe('screenSettingsCard', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it.each([
		{
			name: 'open by default',
			props: {},
			expanded: 'true',
			afterToggle: 'false',
		},
		{
			name: 'defaultOpen: false',
			props: { defaultOpen: false },
			expanded: 'false',
			afterToggle: 'true',
		},
	])('$name: the toggle\'s aria-expanded follows the open body', async ({ props, expanded, afterToggle }) => {
		const wrapper = mountCard(props);
		await flushPromises();

		expect(toggle(wrapper).attributes('aria-expanded')).toBe(expanded);
		expect(wrapper.find('[data-testid="field"]').exists()).toBe(expanded === 'true');
		expect(wrapper.get('[data-testid="action"]').text()).toBe(expanded === 'true'
			? 'open'
			: 'closed');
		const body = wrapper.find(`#${toggle(wrapper).attributes('aria-controls')}`);
		expect(body.exists()).toBe(expanded === 'true');

		await toggle(wrapper).trigger('click');

		expect(toggle(wrapper).attributes('aria-expanded')).toBe(afterToggle);
		expect(wrapper.find('[data-testid="field"]').exists()).toBe(afterToggle === 'true');
		expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Card Badges']);
	});

	it('collapsible: false shows its body with no toggle', async () => {
		const wrapper = mountCard({ collapsible: false, subtitle: 'Badges on each card.' });
		await flushPromises();

		expect(toggle(wrapper).exists()).toBe(false);
		expect(wrapper.find('[data-testid="field"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Badges on each card.');
	});
});
