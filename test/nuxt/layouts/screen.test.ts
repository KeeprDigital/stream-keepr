import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseHead } = vi.hoisted(() => ({ mockUseHead: vi.fn() }));

mockNuxtImport('useHead', () => mockUseHead);

async function mountLayout() {
	const componentPath = '../../../app/layouts/screen.vue';
	const { default: ScreenLayout } = await import(componentPath);

	return mount(ScreenLayout, {
		slots: { default: '<div data-testid="screen-content">output</div>' },
	});
}

describe('screenLayout', () => {
	beforeEach(() => {
		mockUseHead.mockReset();
	});

	it('renders the screen output centered in a full-viewport container', async () => {
		const wrapper = await mountLayout();

		const container = wrapper.get('div');
		expect(container.classes()).toEqual(expect.arrayContaining(['h-screen', 'w-screen', 'overflow-hidden', 'flex', 'items-center', 'justify-center']));
		expect(wrapper.get('[data-testid="screen-content"]').text()).toBe('output');
	});

	it('overrides the body background so the output can be keyed transparent', async () => {
		await mountLayout();

		expect(mockUseHead).toHaveBeenCalledWith({
			bodyAttrs: {
				class: 'transparent-body-override',
			},
		});
	});
});
