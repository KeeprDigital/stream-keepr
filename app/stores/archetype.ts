import type {
	Archetype,
	CreateArchetypeInput,
	UpdateArchetypeInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataResource } from '~/modules/event-data/client';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';

export const useArchetypeStore = defineStore('archetype', () => {
	const repo = useEventDataResource<Archetype, CreateArchetypeInput, UpdateArchetypeInput>({
		resourcePath: 'archetypes',
		eventScoped: true,
		includeHeaders: true,
		responseKey: 'archetypes',
	});
	const { executeReporting } = useReportingAction();
	const apiHeaders = useApiHeaders();

	const lifecycle = useEventDataLifecycle<Archetype, CreateArchetypeInput, UpdateArchetypeInput>({
		repository: repo,
		entityLabel: 'Archetype',
	});
	const archetypes = lifecycle.items;
	const loading = lifecycle.loading;
	const error = lifecycle.error;
	const isLoaded = lifecycle.isLoaded;

	// ── Actions ──

	function invalidateMetagame() {
		useMetagameStore().applyRemoteInvalidated();
	}

	async function loadByEventId(eventId: number) {
		return lifecycle.loadByEventId(eventId);
	}

	async function createArchetype(eventId: number, input: CreateArchetypeInput) {
		const created = await lifecycle.create(eventId, input);
		if (created)
			invalidateMetagame();
		return created;
	}

	async function updateArchetype(eventId: number, archetypeId: number, input: UpdateArchetypeInput) {
		const updated = await lifecycle.update(eventId, archetypeId, input);
		if (updated) {
			usePlayerDeckStore().applyArchetypeUpdated(updated);
			await Promise.allSettled([
				useFeatureMatchStore().loadFeatureMatchesByEventId(eventId),
			]);
			invalidateMetagame();
		}
		return updated;
	}

	/**
	 * Set key cards for an archetype by card name.
	 * Names are resolved to IDs server-side via the cards catalog.
	 *
	 * Reported *and* re-raised, because the modal that saves key cards shows the raised
	 * error's own message as its title — so a card name the catalogue does not know has
	 * to arrive as the sentence saying so rather than as a status line (#262).
	 */
	async function setKeyCards(eventId: number, archetypeId: number, cardNames: string[]) {
		return executeReporting(
			async () => {
				const result = await $fetch<{ keyCards: Array<{ id: number; name: string; game: string; scryfallId: string | null; cardType: string | null; colors: string | null; cmc: number | null; manaCost: string | null }> }>(
					`/api/events/${eventId}/archetypes/${archetypeId}/cards`,
					{ method: 'PATCH', body: { cardNames }, headers: apiHeaders.getHeaders() },
				);
				// Update local archetype with new key cards
				const index = archetypes.value.findIndex(a => a.id === archetypeId);
				if (index !== -1) {
					archetypes.value[index] = { ...archetypes.value[index]!, keyCards: result.keyCards };
				}
				invalidateMetagame();
				return result.keyCards;
			},
			{ errorRef: error, throwError: true },
		);
	}

	async function removeArchetype(eventId: number, archetypeId: number) {
		const removed = await lifecycle.remove(eventId, archetypeId);
		if (removed) {
			usePlayerDeckStore().applyArchetypeDeleted(archetypeId);
			await Promise.allSettled([
				useFeatureMatchStore().loadFeatureMatchesByEventId(eventId),
			]);
			invalidateMetagame();
		}
		return removed;
	}

	/** Find an archetype by name (case-sensitive) */
	function findByName(name: string): Archetype | undefined {
		return archetypes.value.find(a => a.name === name);
	}

	/** Find an archetype by name and color identity (order-independent, case-sensitive) */
	function findByNameAndColors(name: string, colors: string[]): Archetype | undefined {
		const inputColors = [...colors].sort().join(',');
		return archetypes.value.find((a) => {
			if (a.name !== name)
				return false;
			const archetypeColors = [...(a.colors ?? [])].sort().join(',');
			return archetypeColors === inputColors;
		});
	}

	// ── Realtime Handlers ──

	function applyRemoteCreated(data: MessageData<'archetype:created'>) {
		lifecycle.applyRemoteCreated(data.archetype as Archetype);
	}

	function applyRemoteUpdated(data: MessageData<'archetype:updated'>) {
		lifecycle.applyRemoteUpdated(data.archetype as Archetype);
		usePlayerDeckStore().applyArchetypeUpdated(data.archetype as Archetype);
	}

	function applyRemoteDeleted(data: MessageData<'archetype:deleted'>) {
		lifecycle.applyRemoteDeleted(data.archetypeId);
		usePlayerDeckStore().applyArchetypeDeleted(data.archetypeId);
	}

	function applyRemoteKeyCardsUpdated(data: MessageData<'archetype:keyCardsUpdated'>) {
		const index = archetypes.value.findIndex(a => a.id === data.archetypeId);
		if (index !== -1) {
			archetypes.value[index] = {
				...archetypes.value[index]!,
				keyCards: data.keyCards.map(({ archetypeId: _id, sortOrder: _order, ...card }) => card),
			};
		}
	}

	function $reset() {
		lifecycle.reset();
	}

	return {
		// State
		archetypes,
		loading,
		error,
		isLoaded,

		// Actions
		loadByEventId,
		createArchetype,
		updateArchetype,
		setKeyCards,
		removeArchetype,
		findByName,
		findByNameAndColors,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		applyRemoteKeyCardsUpdated,
		$reset,
	};
});
