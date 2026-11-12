import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import EmptyArchetypes from '~/components/Metagame/EmptyArchetypes.vue';

const modal = {
	open: vi.fn(),
};
mockNuxtImport('useOverlay', () => () => ({
	create: () => modal,
}));

const archetypeStore = reactive({
	archetypes: [] as any[],
	isLoaded: true,
	loadByEventId: vi.fn(),
	removeEmptyArchetypes: vi.fn(),
});
mockNuxtImport('useArchetypeStore', () => () => archetypeStore);
mockNuxtImport('usePlayerDeckStore', () => () => reactive({
	decks: [
		{ id: 10, playerId: 1, archetypeId: 1 },
	],
	isLoaded: true,
	loadByEventId: vi.fn(),
}));
mockNuxtImport('usePlayerStore', () => () => reactive({
	players: [],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
}));

const HELD = createMockUiArchetype({ id: 1, name: 'Burn' });

function mountList(empties: string[]) {
	archetypeStore.archetypes = [
		HELD,
		...empties.map((name, index) => createMockUiArchetype({ id: index + 2, name })),
	];
	return mount(EmptyArchetypes, {
		props: { eventId: 9 },
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLink: {
					props: ['to'],
					template: '<a :href="to"><slot /></a>',
				},
			},
		},
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	archetypeStore.removeEmptyArchetypes.mockResolvedValue([]);
});

describe('the Metagame page\'s list of Empty Archetypes', () => {
	it('is not shown while every Archetype holds a deck', () => {
		expect(mountList([]).find('[data-empty-archetypes]').exists()).toBe(false);
	});

	it('counts them and links each to its page', () => {
		const wrapper = mountList(['Dredge', 'Storm']);

		expect(wrapper.get('[data-empty-archetypes]').text()).toContain('2 empty archetypes');
		expect(wrapper.findAll('a').map(link => [
			link.text(),
			link.attributes('href'),
		])).toEqual([
			['Dredge', '/event/9/metagame/archetype/2'],
			['Storm', '/event/9/metagame/archetype/3'],
		]);
	});

	it.each([
		['removes them all once the operator confirms their names', true, 1],
		['removes none when the operator declines', false, 0],
	])('%s', async (_case, confirmed, writes) => {
		modal.open.mockReturnValue({
			result: Promise.resolve(confirmed),
		});
		const wrapper = mountList(['Dredge', 'Storm']);

		await wrapper.get('button[aria-label="Remove all empty archetypes"]').trigger('click');
		await flushPromises();

		expect(modal.open.mock.calls[0]![0].description).toContain('Dredge, Storm');
		expect(archetypeStore.removeEmptyArchetypes).toHaveBeenCalledTimes(writes);
	});
});
