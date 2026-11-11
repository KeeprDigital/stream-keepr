import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import FeatureMatchSlotField from '~/components/Screen/FeatureMatchSlotField.vue';

// What the Feature Match Slot picker adds to an Event Reference picker: `detailed`, each side's
// deck under its Slot. Loading, picking and clearing: `eventReferencePickers.test.ts`.

const { slotItems } = vi.hoisted(() => ({
	slotItems: { value: [] as Record<string, unknown>[] },
}));

mockNuxtImport('useFeatureMatchMenuItems', () => () => ref(slotItems.value));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	loadFeatureMatchesByEventId: vi.fn(),
}));
vi.mock('~/modules/event-data/resync', () => ({
	useConsumedEventData: vi.fn(),
}));

/** A select listing each item through its `item-label` slot, as `USelect`'s menu does. */
const USelectMenuListStub = defineComponent({
	props: {
		items: {
			type: Array,
			default: () => [],
		},
	},
	template: `<ul>
		<li v-for="item in items" :key="String(item.value)" data-testid="slot-option">
			<slot name="item-label" :item="item">{{ item.label }}</slot>
		</li>
	</ul>`,
});

const MtgManaColorDisplayStub = defineComponent({
	props: {
		colors: { type: String, required: true },
	},
	template: '<i :data-colors="colors" />',
});

function slot(value: number, label: string, decks: [string | null, string | null], colors: [string | null, string | null]) {
	return {
		value,
		label,
		player1Name: 'A',
		player1DeckName: decks[0],
		player1Colors: colors[0],
		player2Name: 'B',
		player2DeckName: decks[1],
		player2Colors: colors[1],
	};
}

describe('screenFeatureMatchSlotField', () => {
	beforeEach(() => {
		slotItems.value = [
			slot(11, 'Match 1 — A vs B', ['Mono Red', 'Azorius Control'], ['R', 'WU']),
			slot(12, 'Match 2', [null, null], [null, null]),
		];
	});

	it.each([
		{
			name: 'detailed: each Slot\'s deck names and colours',
			detailed: true,
			texts: ['Select a slot…', 'Match 1 — A vs B Mono Red vs Azorius Control', 'Match 2'],
			colors: ['R', 'WU'],
		},
		{
			name: 'plain: each Slot\'s label alone',
			detailed: false,
			texts: ['Select a slot…', 'Match 1 — A vs B', 'Match 2'],
			colors: [],
		},
	])('lists every Feature Match Slot, $name', ({ detailed, texts, colors }) => {
		const wrapper = mount(FeatureMatchSlotField, {
			props: { modelValue: 11, eventId: 1, detailed },
			global: {
				stubs: {
					...nuxtUiStubs,
					USelect: USelectMenuListStub,
					MtgManaColorDisplay: MtgManaColorDisplayStub,
				},
			},
		});

		const optionText = (option: Element) => [
			...option.querySelectorAll('span'),
		].map(span => span.textContent).join(' ') || option.textContent!.trim();

		expect(wrapper.findAll('[data-testid="slot-option"]').map(option => optionText(option.element))).toEqual(texts);
		expect(wrapper.findAll('[data-colors]').map(color => color.attributes('data-colors'))).toEqual(colors);
	});
});
