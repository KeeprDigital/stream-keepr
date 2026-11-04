import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs, USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import PlayerListField from '~/components/Screen/PlayerListField.vue';

// The Player List picker of Screen settings: each of the Event's Player Lists, or where to make
// one, emitting the list's id, or `null` for none, which deletes the reference.

const { playerListStore } = vi.hoisted(() => ({
	playerListStore: {
		lists: [] as { id: number; name: string; memberCount: number }[],
	},
}));

mockNuxtImport('usePlayerListStore', () => () => playerListStore);

describe('screenPlayerListField', () => {
	function mountField(lists: { id: number; name: string; memberCount: number }[], modelValue?: number) {
		playerListStore.lists = lists;
		return mount(PlayerListField, {
			props: { modelValue, description: 'Include players from this list only.' },
			global: {
				stubs: { ...nuxtUiStubs, USelect: USelectStub },
			},
		});
	}

	it.each([
		{
			name: 'each Player List with its member count',
			lists: [
				{ id: 7, name: 'Feature Table', memberCount: 4 },
			],
			options: ['Select a list...', 'Feature Table (4)'],
			empty: false,
		},
		{
			name: 'that there is none to pick while the Event has none',
			lists: [],
			options: [],
			empty: true,
		},
	])('offers $name', ({ lists, options, empty }) => {
		const wrapper = mountField(lists);

		expect(wrapper.findAll('option').map(option => option.text()).filter(Boolean)).toEqual(options);
		expect(wrapper.text().includes('No player lists available')).toBe(empty);
	});

	it.each([
		{
			name: 'a Player List',
			held: undefined,
			pick: '7',
			emitted: 7,
		},
		{
			name: 'null for no list',
			held: 7,
			pick: 'null',
			emitted: null,
		},
	])('emits $name', async ({ held, pick, emitted }) => {
		const wrapper = mountField([
			{ id: 7, name: 'Feature Table', memberCount: 4 },
		], held);
		await wrapper.get('select').setValue(pick);

		expect(wrapper.emitted('update:modelValue')).toEqual([
			[emitted],
		]);
	});
});
