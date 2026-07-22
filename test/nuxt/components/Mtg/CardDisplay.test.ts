import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref } from 'vue';
import { mtgCardSizeFromHeight } from '~~/shared/utils/card/size';

const mockCardStore = {
	setActiveScreen: vi.fn(),
	loadActiveCard: vi.fn(),
};

const activeCard = ref<any>(null);
const overlayContainer = ref<HTMLElement | null>(null);
const containerHeight = ref(1080);

vi.mock('@vueuse/core', async (importOriginal) => {
	const mod = await importOriginal<typeof import('@vueuse/core')>();
	return {
		...mod,
		useElementSize: () => ({
			width: ref(1920),
			height: containerHeight,
		}),
	};
});

mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1 }),
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer,
}));

mockNuxtImport('useCardStore', () => () => mockCardStore);
mockNuxtImport('storeToRefs', () => () => ({ activeCard }));

const CardImageStub = defineComponent({
	props: {
		card: { type: Object, required: false },
	},
	template: '<div data-testid="card-image">{{ card?.name }}</div>',
});

async function mountComponent() {
	const componentPath = '../../../../app/components/Mtg/CardDisplay.vue';
	const { default: CardDisplay } = await import(componentPath);

	return mount(CardDisplay, {
		props: {
			screenId: 1,
			config: { scale: 1, animationEnabled: true, animationSpeed: 'normal' },
		},
		global: {
			stubs: {
				MtgCardImage: CardImageStub,
			},
		},
	});
}

describe('mtgCardDisplay', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		containerHeight.value = 1080;
		activeCard.value = null;
		mockCardStore.loadActiveCard.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('sizes the card container from the overlay height', async () => {
		const wrapper = await mountComponent();

		activeCard.value = {
			id: 'card-1',
			name: 'Brainstorm',
			displayData: null,
			imageData: { front: { normal: 'https://example.com/card.jpg' } },
		};

		await nextTick();
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(50);
		await nextTick();

		const expected = mtgCardSizeFromHeight(1080);
		const container = wrapper.get('.card-container');

		expect(container.attributes('style')).toContain(`width: ${expected.diagonal}px;`);
		expect(container.attributes('style')).toContain(`height: ${expected.diagonal}px;`);
		expect(mockCardStore.setActiveScreen).toHaveBeenCalledWith(1);
		expect(mockCardStore.loadActiveCard).toHaveBeenCalled();
	});

	it('reacts to overlay container size changes', async () => {
		const wrapper = await mountComponent();

		activeCard.value = {
			id: 'card-2',
			name: 'Ponder',
			displayData: null,
			imageData: { front: { normal: 'https://example.com/card.jpg' } },
		};

		await nextTick();
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(50);
		await nextTick();

		containerHeight.value = 720;
		await nextTick();

		const expected = mtgCardSizeFromHeight(720);
		expect(wrapper.get('.card-container').attributes('style')).toContain(`height: ${expected.diagonal}px;`);
	});

	it('does not let an old image timer reveal a replacement card early', async () => {
		const wrapper = await mountComponent();
		activeCard.value = {
			id: 'old-card',
			name: 'Old Card',
			displayData: null,
			imageData: { front: { normal: 'https://example.com/old.jpg' } },
		};
		await nextTick();
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(40);

		activeCard.value = {
			id: 'new-card',
			name: 'New Card',
			displayData: null,
			imageData: { front: { normal: 'https://example.com/new.jpg' } },
		};
		await nextTick();
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(10);
		await nextTick();
		expect(wrapper.find('[data-testid="card-image"]').exists()).toBe(false);

		await vi.advanceTimersByTimeAsync(40);
		await nextTick();
		expect(wrapper.get('[data-testid="card-image"]').text()).toBe('New Card');
	});
});
