import type { ArchetypePlayerEntry } from '~~/shared/types/metagame';
import type { Player } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, reactive } from 'vue';

const mockPlayerStore = reactive({
	players: [] as Player[],
});

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);

const UCardStub = defineComponent({
	template: '<div><slot name="header" /><slot /></div>',
});

const UTableStub = defineComponent({
	props: {
		data: { type: Array, required: true },
	},
	template: `
		<table>
			<tbody>
				<tr v-for="row in data" :key="row.id">
					<td>
						<slot name="name-cell" :row="{ original: row }">
							{{ row.name }}
						</slot>
					</td>
					<td>
						<slot name="deckList-cell" :row="{ original: row }" />
					</td>
				</tr>
			</tbody>
		</table>
	`,
});

const UButtonStub = defineComponent({
	template: '<button v-bind="$attrs"><slot /></button>',
});

function makePlayer(overrides: Partial<Player> = {}): Player {
	return {
		id: 7,
		eventId: 99,
		name: 'Alice',
		pronouns: null,
		externalSource: null,
		archetypeId: null,
		lgs: null,
		externalId: null,
		wins: 3,
		losses: 1,
		draws: 0,
		position: 4,
		points: 9,
		gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as Player;
}

function makeEntry(overrides: Partial<ArchetypePlayerEntry> = {}): ArchetypePlayerEntry {
	return {
		id: 7,
		name: 'Alice',
		deckName: 'Azorius Control',
		position: 4,
		points: 9,
		wins: 3,
		losses: 1,
		draws: 0,
		colors: 'WU',
		...overrides,
	};
}

async function mountComponent(players: ArchetypePlayerEntry[]) {
	const { default: PlayersTable } = await import('~/components/Metagame/PlayersTable.vue');

	return mount(PlayersTable, {
		props: { players },
		global: {
			stubs: {
				UCard: UCardStub,
				UTable: UTableStub,
				UBadge: true,
				UButton: UButtonStub,
				MtgManaColorDisplay: true,
			},
		},
	});
}

describe('metagame players table', () => {
	it('emits the resolved full player when the deck-list action is clicked', async () => {
		const player = makePlayer();
		mockPlayerStore.players = [player];

		const wrapper = await mountComponent([makeEntry()]);
		await wrapper.get('[aria-label="View deck list"]').trigger('click');

		expect(wrapper.emitted('viewDeckList')).toEqual([[
			player,
		]]);
	});

	it('renders player text without a deck-list action until the full player is loaded', async () => {
		mockPlayerStore.players = [];

		const wrapper = await mountComponent([makeEntry()]);

		expect(wrapper.find('button').exists()).toBe(false);
		expect(wrapper.text()).toContain('Alice');
	});
});
