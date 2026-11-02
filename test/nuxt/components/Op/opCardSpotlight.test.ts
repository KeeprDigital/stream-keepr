import type { OpPrinting, OpScreenCard } from '~~/shared/types/card/op';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import OpCardControls from '~/components/Op/CardControls.vue';
import OpCardList from '~/components/Op/CardList.vue';

const printings: OpPrinting[] = [
	{
		id: 'OP01-001',
		setId: 'OP-01',
		kind: 'standard',
		rarity: 'L',
		imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
	},
	{
		id: 'OP01-001_p1',
		setId: 'OP-01',
		kind: 'alt-art',
		rarity: 'L',
		imageUrl: 'https://cards-img.keepr.digital/OP01-001_p1.png',
	},
];

const useMockCardStore = defineStore('mock-op-card', () => {
	const opCardDataAvailable = ref<boolean | null>(null);
	const opSearchError = ref<string | null>(null);
	const opSearching = ref(false);
	const opSearchResults = ref([]);
	const opPreviewCard = ref<OpScreenCard | null>(null);
	const opPreviewPrintings = ref<OpPrinting[]>([]);
	const activeCard = ref(null);
	const activeScreenId = ref<number | null>(5);
	const cardsMatch = ref(false);

	function selectOpPrinting(id: string) {
		const printing = opPreviewPrintings.value.find(entry => entry.id === id)!;
		opPreviewCard.value = {
			...opPreviewCard.value!,
			id,
			printingKind: printing.kind,
			imageUrl: printing.imageUrl,
		};
	}

	return {
		opCardDataAvailable,
		opSearchError,
		opSearching,
		opSearchResults,
		opPreviewCard,
		opPreviewPrintings,
		activeCard,
		activeScreenId,
		cardsMatch,
		timeout: { isActive: false, remaining: 0 },
		selectOpPrinting,
		selectOpCard: vi.fn(),
		showOpPreviewCard: vi.fn(),
		controlActiveCard: vi.fn(),
	};
});

mockNuxtImport('useCardStore', () => () => useMockCardStore());
mockNuxtImport('useEventStore', () => () => ({
	event: null,
	updateEvent: vi.fn(),
}));

const mountOptions = {
	global: { stubs: nuxtUiStubs },
};

describe('one Piece Card Spotlight', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it.each([
		[false, null, 'Card data unavailable'],
		[true, null, 'No cards match this search.'],
		[true, 'Card search failed. Try again.', 'Card search failed. Try again.'],
	])('with card data available %s and error %s, the list says %s', (available, error, text) => {
		const store = useMockCardStore();
		store.opCardDataAvailable = available;
		store.opSearchError = error;

		expect(mount(OpCardList, mountOptions).text()).toContain(text);
	});

	it('marks the Printing previewed, and moves the mark to the alt-art chosen', async () => {
		const store = useMockCardStore();
		store.opPreviewPrintings = printings;
		store.opPreviewCard = {
			game: 'op',
			id: 'OP01-001',
			number: 'OP01-001',
			name: 'Roronoa Zoro',
			set: 'OP-01',
			printingKind: 'standard',
			imageUrl: printings[0]!.imageUrl,
		};
		const wrapper = mount(OpCardControls, mountOptions);
		const choice = (kind: string) => wrapper.get(`[aria-label="Select card Roronoa Zoro ${kind} OP-01"]`);

		expect(choice('Standard').attributes('aria-pressed')).toBe('true');
		expect(choice('Alt art').attributes('aria-pressed')).toBe('false');

		await choice('Alt art').trigger('click');

		expect(choice('Alt art').attributes('aria-pressed')).toBe('true');
		expect(wrapper.get('img[alt="Roronoa Zoro"]').attributes('src')).toBe('https://cards-img.keepr.digital/OP01-001_p1.png');
	});
});
