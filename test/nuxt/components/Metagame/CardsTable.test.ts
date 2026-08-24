import type { BoardSelection } from '~~/shared/types/enums';
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

const UCardStub = defineComponent({
	template: '<div><slot name="header" /><slot /></div>',
});

const UBadgeStub = defineComponent({
	template: '<span><slot /></span>',
});

const UFieldGroupStub = defineComponent({
	template: '<div><slot /></div>',
});

const UInputStub = defineComponent({
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

const UTableStub = defineComponent({
	props: {
		data: { type: Array, required: true },
		columns: { type: Array, required: true },
	},
	template: `
		<table>
			<tbody>
				<tr v-for="row in data" :key="row.id">
					<td v-for="column in columns" :key="column.accessorKey">{{ row[column.accessorKey] }}</td>
				</tr>
			</tbody>
		</table>
	`,
});

function makeEntry(overrides?: Partial<CardBreakdownEntry>): CardBreakdownEntry {
	return {
		id: 1,
		name: 'Lightning Bolt',
		cardType: 'Instant',
		scryfallId: null,
		colors: 'R',
		cmc: 1,
		manaCost: '{R}',
		inclusionRate: 50,
		avgCopies: 3,
		totalCopies: 6,
		mainboardCount: 4,
		sideboardCount: 2,
		mainboardDeckCount: 1,
		sideboardDeckCount: 1,
		deckCount: 2,
		...overrides,
	};
}

async function mountComponent() {
	const { default: CardsTable } = await import('~/components/Metagame/CardsTable.vue');

	return mount(defineComponent({
		components: { CardsTable },
		setup() {
			const boardFilter = ref<BoardSelection>('full');
			const loading = ref(false);
			const entriesByBoard: Record<BoardSelection, CardBreakdownEntry[]> = {
				full: [makeEntry()],
				mainboard: [makeEntry({ inclusionRate: 25, avgCopies: 4, totalCopies: 4, deckCount: 1 })],
				sideboard: [makeEntry({ inclusionRate: 25, avgCopies: 2, totalCopies: 2, deckCount: 1 })],
			};

			return { boardFilter, entriesByBoard, loading };
		},
		template: `
			<CardsTable
				:entries="entriesByBoard[boardFilter]"
				:loading="loading"
				:sort-by="'inclusionRate'"
				:board-filter="boardFilter"
				@update:board-filter="boardFilter = $event"
			/>
		`,
	}), {
		global: {
			stubs: {
				UCard: UCardStub,
				UBadge: UBadgeStub,
				UFieldGroup: UFieldGroupStub,
				UInput: UInputStub,
				UButton: UButtonStub,
				UTable: UTableStub,
				MetagameMetaShareBar: true,
			},
		},
	});
}

describe('metagameCardsTable', () => {
	it('keeps the current table mounted while loading', async () => {
		const wrapper = await mountComponent();

		(wrapper.vm as { loading: boolean }).loading = true;
		await nextTick();

		expect(wrapper.find('table').exists()).toBe(true);
		expect(wrapper.find('[data-testid="cards-table-loading-overlay"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Lightning Bolt');
	});
});
