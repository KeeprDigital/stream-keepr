import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ArchetypeTable from '~/components/Metagame/ArchetypeTable.vue';

mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(() => ({
		open: vi.fn(),
	})),
}));

describe('metagameArchetypeTable', () => {
	it('keeps the current rows on screen while a new read loads', async () => {
		const wrapper = mount(ArchetypeTable, {
			props: {
				entries: [
					{
						id: 1,
						name: 'Azorius Control',
						colors: 'WU',
						chartSeries: null,
						count: 12,
						metaShare: 37.5,
						winRate: 55.2,
						avgPosition: 3.2,
						conversionRate: null,
						keyCards: [],
					},
				],
				totalPlayers: 32,
				loading: false,
				sortBy: 'metaShare',
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					UTable: {
						props: ['data'],
						template: '<table><tr v-for="row in data" :key="row.id"><td>{{ row.name }}</td></tr></table>',
					},
					MtgManaColorDisplay: true,
					MetagameMetaShareBar: true,
				},
			},
		});

		await wrapper.setProps({ loading: true });

		expect(wrapper.find('[data-testid="archetype-table-loading-overlay"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Azorius Control');
	});

	// An OP Metagame reads participation only, and an OP Archetype is a Leader's colours (ADR-0074).
	it.each([
		[
			'mtg',
			[
				'name',
				'count',
				'metaShare',
				'winRate',
				'avgPosition',
				'conversionRate',
				'actions',
			],
		],
		[
			'op',
			[
				'name',
				'count',
				'metaShare',
				'actions',
			],
		],
	] as const)('on a %s Event, shows the columns %j', (game, columns) => {
		const wrapper = mount(ArchetypeTable, {
			props: {
				entries: [
					{
						id: 1,
						name: 'Monkey.D.Luffy',
						colors: 'Red/Green',
						chartSeries: null,
						count: 12,
						metaShare: 37.5,
						winRate: null,
						avgPosition: null,
						conversionRate: null,
						keyCards: [],
					},
				],
				totalPlayers: 32,
				loading: false,
				sortBy: 'metaShare',
				game,
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					UTable: {
						props: ['data', 'columns'],
						template: '<table><tr><th v-for="column in columns" :key="column.accessorKey ?? column.id" data-testid="column">{{ column.accessorKey ?? column.id }}</th></tr><tr v-for="row in data" :key="row.id"><td><slot name="name-cell" :row="{ original: row }" /></td></tr></table>',
					},
					MtgManaColorDisplay: { template: '<span data-testid="mana" />' },
					MetagameMetaShareBar: true,
				},
			},
		});

		expect(wrapper.findAll('[data-testid="column"]').map(column => column.text())).toEqual(columns);
		if (game === 'op')
			expect(wrapper.findAll('[data-op-color]').map(pip => pip.attributes('data-op-color'))).toEqual(['Red', 'Green']);
	});
});
