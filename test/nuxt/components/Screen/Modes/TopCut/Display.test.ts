import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { computed, defineComponent } from 'vue';

mockNuxtImport('useScreenModeConfig', () => () => computed(() => ({ bracketSize: 8 })));

const IconStub = defineComponent({
	props: {
		name: { type: String, required: true },
	},
	template: '<i :data-icon="name" />',
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/TopCut/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				UIcon: IconStub,
			},
		},
	});
}

describe('screenModesTopCutDisplay', () => {
	// Only the placeholder text is pinned: the mode is a stated stub, and the
	// eventual real Top Cut rendering should replace this test, not fight it.
	it('renders the coming-soon placeholder', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('.topcut-display').exists()).toBe(true);
		expect(wrapper.text()).toContain('Top Cut / Bracket');
		expect(wrapper.text()).toContain('Coming soon');
	});
});
