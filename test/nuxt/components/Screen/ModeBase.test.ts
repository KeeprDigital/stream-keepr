import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ModeBase from '~/components/Screen/ModeBase.vue';

async function mountComponent(props: { error: string | null; empty: boolean }) {
	return mount(ModeBase, {
		props,
		slots: {
			default: '<div data-testid="mode-content">Visible content</div>',
		},
	});
}

describe('screenModeBase', () => {
	it('renders slot content when not error or empty', async () => {
		const wrapper = await mountComponent({ error: null, empty: false });

		expect(wrapper.find('[data-testid="mode-content"]').exists()).toBe(true);
	});

	it('renders blank on error', async () => {
		const wrapper = await mountComponent({ error: 'Failed', empty: false });

		expect(wrapper.find('[data-testid="mode-content"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
	});

	it('renders blank when empty', async () => {
		const wrapper = await mountComponent({ error: null, empty: true });

		expect(wrapper.find('[data-testid="mode-content"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
	});
});
