import type { ScreenOutputReadScope } from '~/composables/repositories/useScreenOutputReadRepository';
import { useScreenOutputReadRepository } from '~/composables/repositories/useScreenOutputReadRepository';
import { SAMPLE_ID, useSampleScreenOutputReadRepository } from '~/modules/screen-mode/sampleDataset';

/**
 * The Screen Output reads of the Screen this rendering shows, bound to it (#604).
 *
 * `scope` is null until both the Screen and its Event are known; every read
 * throws without one, so a caller checks `scope` where it would otherwise have
 * checked for a loaded Event. The server derives each resource from the
 * Screen's saved configuration, so a caller re-reads when the configuration
 * its read depends on changes.
 *
 * A Theme preview's sample context reads the Screen Mode Sample Dataset
 * instead, at a scope of its own, and nothing is fetched.
 */
export function useScreenOutputReads() {
	const { screen, eventId, assetCapability, sampleDataset } = useScreenContext();
	const repository = sampleDataset
		? useSampleScreenOutputReadRepository()
		: useScreenOutputReadRepository();

	const scope = computed<ScreenOutputReadScope | null>(() => {
		if (sampleDataset)
			return { eventId: SAMPLE_ID, screenId: SAMPLE_ID };
		if (!eventId.value || !screen.value)
			return null;
		return { eventId: eventId.value, screenId: screen.value.id, assetCapability: assetCapability?.value ?? null };
	});

	/**
	 * Which Screen, Event and credential the reads go to, as one comparable value.
	 * A mode watches this beside the configuration fields its read depends on, so
	 * it re-reads when either changes and not on every unrelated Screen save.
	 */
	const scopeKey = computed(() => scope.value
		? `${scope.value.eventId}:${scope.value.screenId}:${scope.value.assetCapability ?? ''}`
		: null);

	function requireScope(): ScreenOutputReadScope {
		if (!scope.value)
			throw new Error('No Screen loaded');
		return scope.value;
	}

	return {
		scope,
		scopeKey,
		card: () => repository.card(requireScope()),
		liveSession: () => repository.liveSession(requireScope()),
		playerHistory: () => repository.playerHistory(requireScope()),
		standings: () => repository.standings(requireScope()),
		pairings: () => repository.pairings(requireScope()),
		archetypeSpotlight: () => repository.archetypeSpotlight(requireScope()),
		headToHead: () => repository.headToHead(requireScope()),
		metagame: () => repository.metagame(requireScope()),
		topCards: () => repository.topCards(requireScope()),
		topCut: () => repository.topCut(requireScope()),
		featureMatchSlot: (slotId: number) => repository.featureMatchSlot(requireScope(), slotId),
		/** The Slot's Feature Match Session, or `null` while it has none — never started by reading. */
		featureMatchSession: async (slotId: number) =>
			(await repository.featureMatchSlot(requireScope(), slotId)).slot.activeSession ?? null,
		playerDecks: (playerId: number, selection?: { deckId?: number }) =>
			repository.playerDecks(requireScope(), playerId, selection),
	};
}
