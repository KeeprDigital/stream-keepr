import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── Mock Dependencies ──

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

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);
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
const mockApiHeaders = {
	getHeaders: vi.fn(() => ({ 'x-realtime-connection-id': 'test-connection-id' })),
};

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('useApiHeaders', () => () => mockApiHeaders);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('usePlayerDeckStore', () => () => mockPlayerDeckStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);

/*
 * `useAsyncAction` is deliberately not mocked, for the reason #245's suite gives: it is
 * the seam every action here reports through, and the hand-written copy that used to
 * stand in for it never caught anything — so `error` was never written and no test here
 * could say what an operator is shown. The real composable is auto-imported, does no I/O
 * and starts no timers (#241, #263).
 */

describe('useArchetypeStore', () => {
	let store: ReturnType<typeof useArchetypeStore>;

	beforeEach(() => {
		for (const key of Object.keys(ablyCallbacks))
			delete ablyCallbacks[key];

		vi.clearAllMocks();
		mockIsSelfOrigin.mockReturnValue(false);
		mockAbly.connectionId = 'test-connection-id';
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});

		useArchetypeStore().$dispose();
		store = useArchetypeStore();
		store.$reset();
		ablyCallbacks.archetype = {
			'archetype:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCreated(data as any),
			'archetype:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'archetype:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteDeleted(data as any),
			'archetype:keyCardsUpdated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteKeyCardsUpdated(data as any),
		};
	});

	// ── Loading ──

	describe('loadByEventId', () => {
		it('populates archetypes state', async () => {
			const archetypes = [
				createMockUiArchetype({ id: 1, name: 'Azorius Control' }),
				createMockUiArchetype({ id: 2, name: 'Rakdos Midrange' }),
			];
			mockRepo.list.mockResolvedValue(archetypes);

			await store.loadByEventId(1);

			expect(store.archetypes).toEqual(archetypes);
		});

		it('sets isLoaded after fetch', async () => {
			mockRepo.list.mockResolvedValue([]);

			expect(store.isLoaded).toBe(false);
			await store.loadByEventId(1);

			expect(store.isLoaded).toBe(true);
		});
	});

	// ── Create ──

	describe('createArchetype', () => {
		it('adds archetype to state', async () => {
			const created = createMockUiArchetype({ id: 3, name: 'Boros Aggro' });
			mockRepo.create.mockResolvedValue(created);

			await store.createArchetype(1, { name: 'Boros Aggro' });

			expect(store.archetypes).toContainEqual(created);
		});

		it('invalidates metagame after successful create', async () => {
			const created = createMockUiArchetype({ id: 3, name: 'Boros Aggro' });
			mockRepo.create.mockResolvedValue(created);

			await store.createArchetype(1, { name: 'Boros Aggro' });

			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});
	});

	// ── Update (optimistic) ──

	describe('updateArchetype', () => {
		it('optimistically updates then applies server response', async () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control' });
			store.archetypes = [archetype];

			const serverUpdated = { ...archetype, name: 'Azorius Control v2' };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updateArchetype(1, 1, { name: 'Azorius Control v2' });

			expect(store.archetypes[0]!.name).toBe('Azorius Control v2');
		});

		it('invalidates metagame after successful update', async () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control' });
			store.archetypes = [archetype];
			mockRepo.update.mockResolvedValue({ ...archetype, name: 'Azorius Control v2' });

			await store.updateArchetype(1, 1, { name: 'Azorius Control v2' });

			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(mockPlayerDeckStore.applyArchetypeUpdated).toHaveBeenCalledWith(expect.objectContaining({
				id: 1,
				name: 'Azorius Control v2',
			}));
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		});
	});

	describe('setKeyCards', () => {
		it('updates key cards and invalidates metagame after successful update', async () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control' });
			store.archetypes = [archetype];
			const keyCards = [{
				id: 10,
				name: 'Counterspell',
				game: 'mtg',
				scryfallId: null,
				cardType: null,
				colors: null,
				cmc: null,
				manaCost: null,
			}];
			mockFetch.mockResolvedValue({ keyCards });

			await store.setKeyCards(1, 1, ['Counterspell']);

			expect(store.archetypes[0]!.keyCards).toEqual(keyCards);
			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/archetypes/1/cards', {
				method: 'PATCH',
				body: { cardNames: ['Counterspell'] },
				headers: { 'x-realtime-connection-id': 'test-connection-id' },
			});
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
		});
	});

	// ── Failure reporting ──

	describe('failure reporting', () => {
		it('reports the sentence the server wrote about a refused create', async () => {
			mockRepo.create.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'An Archetype with that name already exists in this Event' },
			}));

			await store.createArchetype(1, { name: 'Azorius Control' });

			expect(store.error).toBe('An Archetype with that name already exists in this Event');
		});

		it('reports the sentence a refused key-card write carries, to the caller as well as to `error`', async () => {
			store.archetypes = [createMockUiArchetype({ id: 1 })];
			mockFetch.mockRejectedValue(transportFailure({
				status: 422,
				body: { message: 'No card named “Counterspel” exists in the catalogue' },
			}));

			// `setKeyCards` reports *and* re-raises, and the modal saving key cards shows
			// the raised message as its own title — so both have to be the sentence.
			await expect(store.setKeyCards(1, 1, ['Counterspel']))
				.rejects
				.toThrow('No card named “Counterspel” exists in the catalogue');
			expect(store.error).toBe('No card named “Counterspel” exists in the catalogue');
		});

		it('reports the transport line for a 5xx, whose body message the server sanitized', async () => {
			mockRepo.create.mockRejectedValue(transportFailure({
				status: 500,
				body: { message: 'Internal Server Error' },
				request: `[POST] "/api/events/1/archetypes"`,
			}));

			await store.createArchetype(1, { name: 'Azorius Control' });

			// 'Internal Server Error' is what `mapPublicNitroError` writes over whatever the
			// server actually failed with. Quoting it back would put a placeholder in front of
			// an operator dressed as the authority's own words; a status line reads as
			// machinery, which is what it is.
			expect(store.error).toBe('[POST] "/api/events/1/archetypes": 500 Internal Server Error');
		});
	});

	// ── Remove (optimistic) ──

	describe('removeArchetype', () => {
		it('removes archetype from state', async () => {
			const archetype = createMockUiArchetype({ id: 1 });
			store.archetypes = [archetype];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeArchetype(1, 1);

			expect(store.archetypes).toHaveLength(0);
		});

		it('invalidates metagame after successful delete', async () => {
			const archetype = createMockUiArchetype({ id: 1 });
			store.archetypes = [archetype];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeArchetype(1, 1);

			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(mockPlayerDeckStore.applyArchetypeDeleted).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		});
	});

	// ── Queries ──

	describe('findByName', () => {
		it('returns archetype when name matches', () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control' });
			store.archetypes = [archetype];

			expect(store.findByName('Azorius Control')).toEqual(archetype);
		});
	});

	describe('findByNameAndColors', () => {
		it('finds archetype by name and colors', () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control', colors: 'WU' });
			store.archetypes = [archetype];

			expect(store.findByNameAndColors('Azorius Control', ['W', 'U'])).toEqual(archetype);
		});

		it('matches colors regardless of input order', () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Azorius Control', colors: 'WU' });
			store.archetypes = [archetype];

			expect(store.findByNameAndColors('Azorius Control', ['U', 'W'])).toEqual(archetype);
		});

		it('matches colorless archetype with empty colors array', () => {
			const archetype = createMockUiArchetype({ id: 1, name: 'Colorless Tron', colors: null });
			store.archetypes = [archetype];

			expect(store.findByNameAndColors('Colorless Tron', [])).toEqual(archetype);
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('archetype:created', () => {
			it('adds archetype from remote message', () => {
				store.archetypes = [];
				const archetype = createMockUiArchetype({ id: 10, name: 'Izzet Phoenix' });

				ablyCallbacks.archetype!['archetype:created']!({ archetype });

				expect(store.archetypes).toHaveLength(1);
				expect(store.archetypes[0]!.name).toBe('Izzet Phoenix');
			});

			it('skips duplicate archetypes', () => {
				const archetype = createMockUiArchetype({ id: 10 });
				store.archetypes = [archetype];

				ablyCallbacks.archetype!['archetype:created']!({ archetype });

				expect(store.archetypes).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', () => {
				mockIsSelfOrigin.mockReturnValueOnce(true);
				store.archetypes = [];

				ablyCallbacks.archetype!['archetype:created']!({ archetype: createMockUiArchetype({ id: 10 }) });

				expect(store.archetypes).toHaveLength(0);
			});
		});

		describe('archetype:updated', () => {
			it('updates existing archetype from remote message', () => {
				store.archetypes = [createMockUiArchetype({ id: 10, name: 'Old Name' })];

				ablyCallbacks.archetype!['archetype:updated']!({ archetype: createMockUiArchetype({ id: 10, name: 'New Name' }) });

				expect(store.archetypes[0]!.name).toBe('New Name');
			});

			it('ignores message when archetype not in state', () => {
				store.archetypes = [createMockUiArchetype({ id: 10, name: 'Existing' })];

				ablyCallbacks.archetype!['archetype:updated']!({ archetype: createMockUiArchetype({ id: 99, name: 'Unknown' }) });

				expect(store.archetypes[0]!.name).toBe('Existing');
			});

			it('skips when isSelfOrigin returns true', () => {
				store.archetypes = [createMockUiArchetype({ id: 10, name: 'Old' })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.archetype!['archetype:updated']!({ archetype: createMockUiArchetype({ id: 10, name: 'New' }) });

				expect(store.archetypes[0]!.name).toBe('Old');
			});
		});

		describe('archetype:deleted', () => {
			it('removes archetype from remote message', () => {
				store.archetypes = [createMockUiArchetype({ id: 10 })];

				ablyCallbacks.archetype!['archetype:deleted']!({ archetypeId: 10 });

				expect(store.archetypes).toHaveLength(0);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.archetypes = [createMockUiArchetype({ id: 10 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.archetype!['archetype:deleted']!({ archetypeId: 10 });

				expect(store.archetypes).toHaveLength(1);
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.archetypes = [createMockUiArchetype()];
			store.error = 'some error';

			store.$reset();

			expect(store.archetypes).toEqual([]);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.isLoaded).toBe(false);
		});
	});
});
