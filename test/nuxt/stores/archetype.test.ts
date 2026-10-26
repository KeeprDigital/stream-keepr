import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

const mockRepo = vi.hoisted(() => ({
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('~/modules/event-data/client', async importOriginal => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockRepo,
}));

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const mockMetagameStore = {
	applyRemoteInvalidated: vi.fn(),
	$reset: vi.fn(),
};
const mockPlayerDeckStore = {
	applyArchetypeUpdated: vi.fn(),
	applyArchetypeDeleted: vi.fn(),
};
const mockFeatureMatchStore = {
	loadFeatureMatchesByEventId: vi.fn(),
};

mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('usePlayerDeckStore', () => () => mockPlayerDeckStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);

const { deliver } = realtimeHandlersFor();

describe('useArchetypeStore', () => {
	let store: ReturnType<typeof useArchetypeStore>;

	beforeEach(() => {
		useArchetypeStore().$dispose();
		store = useArchetypeStore();
		store.$reset();
	});

	describe('writes follow up on what an Archetype touches', () => {
		it('a create invalidates the Metagame', async () => {
			const created = createMockUiArchetype({ id: 3, name: 'Boros Aggro' });
			mockRepo.create.mockResolvedValue(created);

			await store.createArchetype(1, { name: 'Boros Aggro' });

			expect(store.archetypes).toContainEqual(created);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});

		it('an update retags Player Decks, reloads the Event\'s Feature Matches and invalidates the Metagame', async () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control' });
			store.archetypes = [archetype];
			mockRepo.update.mockResolvedValue({ ...archetype, name: 'Azorius Control v2' });

			await store.updateArchetype(1, 1, { name: 'Azorius Control v2' });

			expect(store.archetypes[0]!.name).toBe('Azorius Control v2');
			expect(mockPlayerDeckStore.applyArchetypeUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'Azorius Control v2' }));
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});

		it('a delete untags Player Decks, reloads the Event\'s Feature Matches and invalidates the Metagame', async () => {
			store.archetypes = [
				createMockUiArchetype({ id: 1 }),
			];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeArchetype(1, 1);

			expect(store.archetypes).toHaveLength(0);
			expect(mockPlayerDeckStore.applyArchetypeDeleted).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});
	});

	describe('setKeyCards', () => {
		it('writes card names and holds the key cards the server resolved', async () => {
			store.archetypes = [
				createMockUiArchetype({ id: 1 }),
			];
			const keyCards = [
				{
					id: 10,
					name: 'Counterspell',
					game: 'mtg',
					scryfallId: null,
					cardType: null,
					colors: null,
					cmc: null,
					manaCost: null,
				},
			];
			mockFetch.mockResolvedValue({ keyCards });

			await store.setKeyCards(1, 1, ['Counterspell']);

			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/archetypes/1/cards', expect.objectContaining({
				method: 'PATCH',
				body: {
					cardNames: ['Counterspell'],
				},
			}));
			expect(store.archetypes[0]!.keyCards).toEqual(keyCards);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});

		it('reports a refused write and re-raises it, because the key-card modal titles itself with the raised message', async () => {
			store.archetypes = [
				createMockUiArchetype({ id: 1 }),
			];
			mockFetch.mockRejectedValue(transportFailure({
				status: 422,
				body: { message: 'No card named “Counterspel” exists in the catalogue' },
			}));

			await expect(store.setKeyCards(1, 1, ['Counterspel']))
				.rejects
				.toThrow('No card named “Counterspel” exists in the catalogue');
			expect(store.error).toBe('No card named “Counterspel” exists in the catalogue');
		});
	});

	// A write is answered for the Event it was made in; its follow-ups belong to that Event's lifetime (#606).
	describe.each([
		[
			'Event B',
			[2],
		],
		[
			'Event A, loaded again since',
			[2, 1],
		],
	])('an Archetype write answered after the operator moved on to %s', (_, switches) => {
		const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control' });

		/** Ends on a collection holding Archetype 1, as Event A's own does when loaded again. */
		async function switchAway() {
			let shown!: ReturnType<typeof createMockUiArchetype>[];
			for (const eventId of switches) {
				shown = [
					createMockUiArchetype({ id: 1, eventId, name: `Loaded for ${eventId}` } as any),
				];
				store.$reset();
				mockRepo.list.mockResolvedValueOnce(structuredClone(shown));
				await store.loadByEventId(eventId);
			}
			vi.clearAllMocks();
			return shown;
		}

		function expectNothingFollowedUp() {
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).not.toHaveBeenCalled();
			expect(mockPlayerDeckStore.applyArchetypeUpdated).not.toHaveBeenCalled();
			expect(mockPlayerDeckStore.applyArchetypeDeleted).not.toHaveBeenCalled();
			expect(mockMetagameStore.applyRemoteInvalidated).not.toHaveBeenCalled();
		}

		it('a late create follows up on nothing', async () => {
			const create = deferred<typeof archetype>();
			mockRepo.create.mockReturnValueOnce(create.promise);

			const creating = store.createArchetype(1, { name: 'Boros Aggro' });
			const shown = await switchAway();
			create.resolve(createMockUiArchetype({ id: 3, name: 'Boros Aggro' }));
			await creating;

			expect(store.archetypes).toEqual(shown);
			expectNothingFollowedUp();
		});

		it('a late update follows up on nothing', async () => {
			store.archetypes = [archetype];
			const update = deferred<typeof archetype>();
			mockRepo.update.mockReturnValueOnce(update.promise);

			const updating = store.updateArchetype(1, 1, { name: 'Azorius Control v2' });
			const shown = await switchAway();
			update.resolve({ ...archetype, name: 'Azorius Control v2' });
			await updating;

			expect(store.archetypes).toEqual(shown);
			expectNothingFollowedUp();
		});

		it('a late delete follows up on nothing', async () => {
			store.archetypes = [archetype];
			const remove = deferred<{ success: true }>();
			mockRepo.remove.mockReturnValueOnce(remove.promise);

			const removing = store.removeArchetype(1, 1);
			const shown = await switchAway();
			remove.resolve({ success: true });
			await removing;

			expect(store.archetypes).toEqual(shown);
			expectNothingFollowedUp();
		});

		it('a late key-card write changes no Archetype and follows up on nothing', async () => {
			store.archetypes = [archetype];
			const write = deferred<{ keyCards: [] }>();
			mockFetch.mockReturnValueOnce(write.promise);

			const writing = store.setKeyCards(1, 1, ['Counterspell']);
			const shown = await switchAway();
			write.resolve({ keyCards: [] });
			await writing;

			expect(store.archetypes).toEqual(shown);
			expectNothingFollowedUp();
		});
	});

	describe('findByNameAndColors', () => {
		it.each([
			[
				'the same colour order',
				'WU',
				['W', 'U'],
			],
			[
				'any colour order',
				'WU',
				['U', 'W'],
			],
			['a colourless Archetype and no colours', null, []],
		])('finds the Archetype for %s', (_, colors, query) => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Control', colors });
			store.archetypes = [archetype];

			expect(store.findByNameAndColors('Control', query)).toEqual(archetype);
		});

		it('finds nothing when the colours differ', () => {
			store.archetypes = [
				createMockUiArchetype({ id: 1, name: 'Control', colors: 'WU' }),
			];

			expect(store.findByNameAndColors('Control', ['U', 'B'])).toBeUndefined();
		});
	});

	describe('a peer\'s Archetype messages', () => {
		it('apply to the collection, keep Player Decks in step and invalidate the Metagame', () => {
			deliver('archetype:created', {
				archetype: createMockUiArchetype({ id: 10, name: 'Izzet Phoenix' }),
			} as never);
			deliver('archetype:updated', {
				archetype: createMockUiArchetype({ id: 10, name: 'Izzet Prowess' }),
			} as never);

			expect(store.archetypes.map(a => a.name)).toEqual(['Izzet Prowess']);
			expect(mockPlayerDeckStore.applyArchetypeUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 10, name: 'Izzet Prowess' }));

			deliver('archetype:deleted', { archetypeId: 10 });

			expect(store.archetypes).toEqual([]);
			expect(mockPlayerDeckStore.applyArchetypeDeleted).toHaveBeenCalledWith(10);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledTimes(3);
		});

		it('hold a key-card update without its join bookkeeping', () => {
			store.archetypes = [
				createMockUiArchetype({ id: 10 }),
			];

			deliver('archetype:keyCardsUpdated', {
				archetypeId: 10,
				keyCards: [
					{
						archetypeId: 10,
						sortOrder: 0,
						id: 1,
						name: 'Counterspell',
						game: 'mtg',
						scryfallId: null,
						cardType: null,
						colors: null,
						cmc: null,
						manaCost: null,
					},
				],
			} as never);

			expect(store.archetypes[0]!.keyCards).toEqual([
				{
					id: 1,
					name: 'Counterspell',
					game: 'mtg',
					scryfallId: null,
					cardType: null,
					colors: null,
					cmc: null,
					manaCost: null,
				},
			]);
		});
	});
});
