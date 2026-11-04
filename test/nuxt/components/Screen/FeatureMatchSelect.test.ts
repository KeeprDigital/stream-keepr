import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import FeatureMatchSelect from '~/components/Screen/FeatureMatchSelect.vue';

// The Feature Match Slot picker of Screen settings: every Slot, optionally with each side's deck,
// emitting the Slot's id, or `null` when cleared, which deletes the reference.

const { slotItems } = vi.hoisted(() => ({
	slotItems: { value: [] as Record<string, unknown>[] },
}));

mockNuxtImport('useFeatureMatchMenuItems', () => () => ref(slotItems.value));

/** A select listing each item through its `item-label` slot, as `USelect`'s menu does. */
const USelectMenuListStub = defineComponent({
	props: {
		modelValue: { type: null, required: false },
		items: {
			type: Array,
			default: () => [],
		},
		placeholder: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: `<ul :data-placeholder="placeholder">
		<li v-for="item in items" :key="item.value" data-testid="slot-option" @click="$emit('update:modelValue', item.value)">
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

describe('screenFeatureMatchSelect', () => {
	beforeEach(() => {
		slotItems.value = [
			slot(11, 'Match 1 — A vs B', ['Mono Red', 'Azorius Control'], ['R', 'WU']),
			slot(12, 'Match 2', [null, null], [null, null]),
		];
	});

	function mountSelect(detailed: boolean) {
		return mount(FeatureMatchSelect, {
			props: { modelValue: 11, placeholder: 'Select a slot…', detailed },
			global: {
				stubs: {
					USelect: USelectMenuListStub,
					MtgManaColorDisplay: MtgManaColorDisplayStub,
				},
			},
		});
	}

	it.each([
		{
			name: 'detailed: each Slot\'s deck names and colours',
			detailed: true,
			texts: ['Match 1 — A vs B Mono Red vs Azorius Control', 'Match 2'],
			colors: ['R', 'WU'],
		},
		{
			name: 'plain: each Slot\'s label alone',
			detailed: false,
			texts: ['Match 1 — A vs B', 'Match 2'],
			colors: [],
		},
	])('lists every Feature Match Slot, $name', ({ detailed, texts, colors }) => {
		const wrapper = mountSelect(detailed);

		const optionText = (option: Element) => [
			...option.querySelectorAll('span'),
		].map(span => span.textContent).join(' ') || option.textContent!.trim();

		expect(wrapper.findAll('[data-testid="slot-option"]').map(option => optionText(option.element))).toEqual(texts);
		expect(wrapper.findAll('[data-colors]').map(color => color.attributes('data-colors'))).toEqual(colors);
	});

	it('emits the Slot picked', async () => {
		const wrapper = mountSelect(false);
		await wrapper.findAll('[data-testid="slot-option"]')[1]!.trigger('click');

		expect(wrapper.emitted('update:modelValue')).toEqual([
			[12],
		]);
	});

	it('emits null when cleared', () => {
		const wrapper = mountSelect(false);
		wrapper.getComponent(USelectMenuListStub).vm.$emit('update:modelValue', undefined);

		expect(wrapper.emitted('update:modelValue')).toEqual([
			[null],
		]);
	});
});
