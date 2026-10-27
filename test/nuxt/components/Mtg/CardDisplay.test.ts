import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref } from 'vue';
import CardDisplay from '~/components/Mtg/CardDisplay.vue';

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
	return mount(CardDisplay, {
		props: {
			screenId: 1,
			config: { animationEnabled: true, animationSpeed: 'normal' },
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

	// Until the host scales the Event Canvas (#821), the card scales it to its container's height.
	it.each([
		{ height: 1080, zoom: '1' },
		{
			height: 720,
			zoom: String(720 / 1080),
		},
		{ height: 0, zoom: '1' },
	])('sizes the card-width Mode Token to a $height px overlay at zoom $zoom', async ({ height, zoom }) => {
		containerHeight.value = height;
		const wrapper = await mountComponent();

		activeCard.value = {
			id: 'card-1',
			name: 'Brainstorm',
			displayData: null,
			imageData: {
				front: { normal: 'https://example.com/card.jpg' },
			},
		};

		await nextTick();
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(50);
		await nextTick();

		const container = wrapper.get('.card-container').element as HTMLElement;
		expect(container.style.zoom).toBe(zoom);
		expect((wrapper.get('[data-testid="spotlight-card"]').element as HTMLElement).style.width).toBe('var(--theme-card-card-width)');
		expect(mockCardStore.setActiveScreen).toHaveBeenCalledWith(1);
		expect(mockCardStore.loadActiveCard).toHaveBeenCalled();
	});

	it('does not let an old image timer reveal a replacement card early', async () => {
		const wrapper = await mountComponent();
		activeCard.value = {
			id: 'old-card',
			name: 'Old Card',
			displayData: null,
			imageData: {
				front: { normal: 'https://example.com/old.jpg' },
			},
		};
		await nextTick();
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(40);

		activeCard.value = {
			id: 'new-card',
			name: 'New Card',
			displayData: null,
			imageData: {
				front: { normal: 'https://example.com/new.jpg' },
			},
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
