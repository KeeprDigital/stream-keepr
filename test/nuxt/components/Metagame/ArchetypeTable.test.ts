import type { ArchetypeBreakdownEntry } from '~~/shared/types/metagame';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(),
	})),
};

mockNuxtImport('useOverlay', () => () => mockOverlay);

const UTableStub = defineComponent({
	props: {
		data: { type: Array, required: true },
		columns: { type: Array, required: true },
	},
	template: `
		<table>
			<tbody>
				<tr v-for="row in data" :key="row.id">
					<td>{{ row.name }}</td>
				</tr>
			</tbody>
		</table>
	`,
});

function makeEntry(overrides: Partial<ArchetypeBreakdownEntry> = {}): ArchetypeBreakdownEntry {
	return {
		id: 1,
		name: 'Azorius Control',
		colors: 'WU',
		count: 12,
		metaShare: 37.5,
		winRate: 55.2,
		avgPosition: 3.2,
		conversionRate: null,
		keyCards: [],
		...overrides,
	};
}

async function mountComponent() {
	const { default: ArchetypeTable } = await import('~/components/Metagame/ArchetypeTable.vue');

	return mount(defineComponent({
		components: { ArchetypeTable },
		setup() {
			const loading = ref(false);

			return {
				loading,
				entries: [makeEntry()],
			};
		},
		template: `
			<ArchetypeTable
				:entries="entries"
				:total-players="32"
				:loading="loading"
				:sort-by="'metaShare'"
			/>
		`,
	}), {
		global: {
			stubs: {
				UTable: UTableStub,
				UButton: true,
				UBadge: true,
				UIcon: true,
				MtgManaColorDisplay: true,
				MetagameMetaShareBar: true,
			},
		},
	});
}

describe('metagameArchetypeTable', () => {
	it('keeps the current table mounted while loading', async () => {
		const wrapper = await mountComponent();

		(wrapper.vm as { loading: boolean }).loading = true;
		await nextTick();

		expect(wrapper.find('table').exists()).toBe(true);
		expect(wrapper.find('[data-testid="archetype-table-loading-overlay"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Azorius Control');
	});
});
