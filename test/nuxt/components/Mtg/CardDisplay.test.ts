import type { MtgCard } from '~/types/card/mtg';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref } from 'vue';
import CardDisplay from '~/components/Mtg/CardDisplay.vue';

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

const CardImageStub = defineComponent({
	props: {
		card: { type: Object, required: false },
	},
	template: '<div data-testid="card-image">{{ card?.name }}</div>',
});

function card(id: string, name: string): MtgCard {
	return {
		id,
		name,
		displayData: null,
		imageData: {
			front: { normal: `https://example.com/${id}.jpg` },
		},
	} as unknown as MtgCard;
}

function mountComponent(shown: MtgCard | null = null) {
	return mount(CardDisplay, {
		props: {
			card: shown,
			width: '400px',
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
		vi.useFakeTimers();
		containerHeight.value = 1080;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// The host scales the Event Canvas to its window (#821); a card scaling it again would scale twice.
	it.each([1080, 720, 0])('sizes the card by its width alone in a %i px overlay', async (height) => {
		containerHeight.value = height;
		const wrapper = mountComponent();

		await wrapper.setProps({
			card: card('card-1', 'Brainstorm'),
		});
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(50);
		await nextTick();

		const container = wrapper.get('.card-container').element as HTMLElement;
		expect(container.style.zoom).toBe('');
		expect((wrapper.get('[data-testid="spotlight-card"]').element as HTMLElement).style.width).toBe('400px');
	});

	it('shows a Card it is given at mount once its image loads', async () => {
		const wrapper = mountComponent(card('held', 'Held Card'));
		await nextTick();

		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(50);
		await nextTick();

		expect(wrapper.get('[data-testid="card-image"]').text()).toBe('Held Card');
	});

	it('does not let an old image timer reveal a replacement card early', async () => {
		const wrapper = mountComponent();
		await wrapper.setProps({
			card: card('old-card', 'Old Card'),
		});
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(40);

		await wrapper.setProps({
			card: card('new-card', 'New Card'),
		});
		await wrapper.get('img').trigger('load');
		await vi.advanceTimersByTimeAsync(10);
		await nextTick();
		expect(wrapper.find('[data-testid="card-image"]').exists()).toBe(false);

		await vi.advanceTimersByTimeAsync(40);
		await nextTick();
		expect(wrapper.get('[data-testid="card-image"]').text()).toBe('New Card');
	});
});
