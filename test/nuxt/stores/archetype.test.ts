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
	applyArchetypeMerged: vi.fn(),
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

	// The lifecycle's own suite owns how a load answers its failure; one case shows
	// the caller's choice reaches it through this store's load.
	it('raises a failed load to a caller that asked', async () => {
		mockRepo.list.mockRejectedValue(new Error('Network unavailable'));

		await expect(store.loadByEventId(1, { failure: 'raise' })).rejects.toThrow('Network unavailable');
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

	describe('merging an Archetype into another', () => {
		const merged = createMockUiArchetype({ id: 1, name: 'Burn' });
		const survivor = createMockUiArchetype({ id: 2, name: 'Boros Burn' });

		it('drops it, moves Player Decks to the survivor, reloads the Event\'s Feature Matches and invalidates the Metagame', async () => {
			store.archetypes = [merged, survivor];
			mockFetch.mockResolvedValue({ archetypeId: 2, mergedArchetypeId: 1 });

			await expect(store.mergeArchetype(9, 1, 2)).resolves.toBe(true);

			expect(mockFetch).toHaveBeenCalledWith('/api/events/9/archetypes/1/merge', expect.objectContaining({
				method: 'POST',
				body: { intoArchetypeId: 2 },
			}));
			expect(store.archetypes).toEqual([survivor]);
			expect(mockPlayerDeckStore.applyArchetypeMerged).toHaveBeenCalledWith(1, survivor);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(9);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});

		it('keeps both when the merge is refused, and says why', async () => {
			store.archetypes = [merged, survivor];
			mockFetch.mockRejectedValue(transportFailure({
				status: 404,
				body: { message: 'Archetype not found' },
			}));

			await expect(store.mergeArchetype(9, 1, 2)).resolves.toBe(false);

			expect(store.archetypes).toEqual([merged, survivor]);
			expect(store.error).toBe('Archetype not found');
			expect(mockPlayerDeckStore.applyArchetypeMerged).not.toHaveBeenCalled();
		});

		it('follows a peer\'s merge the same way, untagging no Player Deck', () => {
			store.archetypes = [merged, survivor];

			deliver('archetype:deleted', { archetypeId: 1, mergedIntoArchetypeId: 2 });

			expect(store.archetypes).toEqual([survivor]);
			expect(mockPlayerDeckStore.applyArchetypeMerged).toHaveBeenCalledWith(1, survivor);
			expect(mockPlayerDeckStore.applyArchetypeDeleted).not.toHaveBeenCalled();
		});
	});

	describe('removing the Empty Archetypes', () => {
		it('drops the Archetypes the server removed and invalidates the Metagame', async () => {
			const held = createMockUiArchetype({ id: 1, name: 'Burn' });
			store.archetypes = [
				held,
				createMockUiArchetype({ id: 2, name: 'Empty' }),
			];
			mockFetch.mockResolvedValue({
				archetypeIds: [2],
			});

			await expect(store.removeEmptyArchetypes(9)).resolves.toEqual([2]);

			expect(mockFetch).toHaveBeenCalledWith('/api/events/9/archetypes/empty', expect.objectContaining({ method: 'DELETE' }));
			expect(store.archetypes).toEqual([held]);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});
	});

	describe('findNameHolder', () => {
		it.each([
			[
				'another Archetype of the name in another case',
				'azorius control',
				2,
				1,
			],
			[
				'none for the Archetype\'s own name',
				'Azorius Control',
				1,
				undefined,
			],
			[
				'none for a free name',
				'Boros Energy',
				2,
				undefined,
			],
		])('finds %s', (_case, name, renamedId, holderId) => {
			store.archetypes = [
				createMockUiArchetype({ id: 1, name: 'Azorius Control' }),
				createMockUiArchetype({ id: 2, name: 'Burn' }),
			];

			expect(store.findNameHolder(name, renamedId)?.id).toBe(holderId);
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
	// Back in the same Event is the case an Event-id comparison would miss.
	describe('an Archetype write answered after the operator moved on to Event A, loaded again since', () => {
		const switches = [2, 1];
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

		it('a late merge drops no Archetype and follows up on nothing', async () => {
			store.archetypes = [archetype];
			const merge = deferred<{ archetypeId: number; mergedArchetypeId: number }>();
			mockFetch.mockReturnValueOnce(merge.promise);

			const merging = store.mergeArchetype(1, 1, 2);
			const shown = await switchAway();
			merge.resolve({ archetypeId: 2, mergedArchetypeId: 1 });
			await merging;

			expect(store.archetypes).toEqual(shown);
			expect(mockPlayerDeckStore.applyArchetypeMerged).not.toHaveBeenCalled();
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

		// Review matches a typed name as the Archetype write does: neither case nor surrounding spaces make another.
		it.each([
			[
				'findByName',
				(name: string) => store.findByName(name),
			],
			[
				'findByNameAndColors',
				(name: string) => store.findByNameAndColors(name, ['W', 'U']),
			],
		])('%s finds a name typed in another case, with spaces around it', (_method, find) => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control', colors: 'WU' });
			store.archetypes = [archetype];

			expect(find('  azorius CONTROL ')).toEqual(archetype);
			expect(find('Azorius')).toBeUndefined();
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
