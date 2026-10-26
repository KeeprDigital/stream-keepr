import type { TokenRequirementEntry } from '~~/shared/types/metagame';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import TokensTable from '~/components/Metagame/TokensTable.vue';

const UTableStub = defineComponent({
	props: {
		data: { type: Array, required: true },
		columns: { type: Array, required: true },
	},
	template: `
		<table>
			<tbody>
				<tr v-for="row in data" :key="row.id">
					<td v-for="column in columns" :key="column.accessorKey || column.id">{{ row[column.accessorKey] }}</td>
				</tr>
			</tbody>
		</table>
	`,
});

function makeEntry(overrides?: Partial<TokenRequirementEntry>): TokenRequirementEntry {
	return {
		id: 'token-map',
		scryfallId: 'token-map',
		name: 'Map',
		typeLine: 'Token Artifact - Map',
		uri: null,
		deckCount: 2,
		sourceCardCount: 1,
		sourceCards: [
			{
				id: 10,
				name: 'Surveyor Saga',
				scryfallId: 'source-10',
				cardType: 'Enchantment',
			},
		],
		...overrides,
	};
}

async function mountComponent() {
	return mount(defineComponent({
		components: { TokensTable },
		setup() {
			const loading = ref(false);
			const entries = ref([
				makeEntry(),
				makeEntry({
					id: 'token-reflection',
					scryfallId: 'token-reflection',
					name: 'Reflection',
					typeLine: 'Token Creature - Reflection',
					deckCount: 1,
					sourceCards: [
						{
							id: 11,
							name: 'Mirror Spell',
							scryfallId: 'source-11',
							cardType: 'Sorcery',
						},
					],
				}),
			]);

			return { entries, loading };
		},
		template: `
			<TokensTable
				:entries="entries"
				:loading="loading"
				:total-decks="3"
				:get-source-card-link="card => '/card/' + card.id"
			/>
		`,
	}), {
		global: {
			stubs: {
				...nuxtUiStubs,
				UTable: UTableStub,
				MetagameCardThumbnail: true,
			},
		},
	});
}

describe('metagameTokensTable', () => {
	it('filters tokens by token name and keeps existing rows mounted while loading', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('input').setValue('map');
		expect(wrapper.text()).toContain('Map');
		expect(wrapper.text()).not.toContain('Reflection');

		(wrapper.vm as { loading: boolean }).loading = true;
		await nextTick();

		expect(wrapper.find('table').exists()).toBe(true);
		expect(wrapper.find('[data-testid="tokens-table-loading-overlay"]').exists()).toBe(true);
	});
});
