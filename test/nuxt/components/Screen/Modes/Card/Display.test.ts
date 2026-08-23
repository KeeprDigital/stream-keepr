import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

const displayConfig = ref<any>({ scale: 1, animationEnabled: true, animationSpeed: 'normal' });
const screenId = ref<number | null>(5);
const error = ref<string | null>(null);

mockNuxtImport('useCardModeData', () => () => ({
	displayConfig: computed(() => displayConfig.value),
	screenId: computed(() => screenId.value),
	error: computed(() => error.value),
}));

const CardDisplayStub = defineComponent({
	props: {
		config: { type: Object, required: true },
		screenId: { type: Number, required: true },
	},
	template: '<div data-testid="card-display" />',
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Card/Display.vue';
	const { default: Display } = await import(componentPath);

	// ScreenModeBase is deliberately left real so the empty/error cases assert the
	// broadcast contract itself: those states render nothing at all.
	return mount(Display, {
		global: {
			stubs: {
				MtgCardDisplay: CardDisplayStub,
			},
		},
	});
}

describe('screenModesCardDisplay', () => {
	beforeEach(() => {
		displayConfig.value = { scale: 1, animationEnabled: true, animationSpeed: 'normal' };
		screenId.value = 5;
		error.value = null;
	});

	it('renders the card display for the active screen with its display config', async () => {
		const wrapper = await mountComponent();

		const cardDisplay = wrapper.getComponent(CardDisplayStub);
		expect(cardDisplay.props('screenId')).toBe(5);
		expect(cardDisplay.props('config')).toEqual({ scale: 1, animationEnabled: true, animationSpeed: 'normal' });
	});

	it('renders nothing without a screen', async () => {
		screenId.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="card-display"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
	});

	it('renders nothing on a load error', async () => {
		error.value = 'Failed to load card data';

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="card-display"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
	});
});
