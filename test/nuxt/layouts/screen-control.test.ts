import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

async function mountLayout() {
	const componentPath = '../../../app/layouts/screen-control.vue';
	const { default: ScreenControlLayout } = await import(componentPath);

	return mount(ScreenControlLayout, {
		slots: { default: '<div data-testid="control-content">controls</div>' },
	});
}

describe('screenControlLayout', () => {
	it('renders the operator surface inside the touch-hardened container', async () => {
		const wrapper = await mountLayout();

		expect(wrapper.get('div').classes()).toContain('control-layout');
		expect(wrapper.get('[data-testid="control-content"]').text()).toBe('controls');
	});
});
