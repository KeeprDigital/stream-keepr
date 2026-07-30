import type { GraphicBindingDataSet } from '~~/shared/modules/graphics';
import type { GraphicSourceSelectionKind } from '~~/shared/types/graphics';

/**
 * The Event Data Live Control resolves Graphic Input Bindings and fills its pickers
 * from.
 *
 * ## Why Live Control resolves at all
 *
 * Acceptance is the server's, and the server resolves bindings itself. This resolves
 * the same bindings for *display*: the "latest bound value" an operator reads, and
 * the pending indication that tells them an Update Graphic has something to accept.
 * Both run the one shared resolution over the same catalog, so the value shown and
 * the value accepted are the same computation rather than two that agree until they
 * do not.
 *
 * It is also what makes relevant Realtime Event Session changes re-resolve affected
 * bindings without asking the server: these are the Event Data stores the Realtime
 * Event Session already keeps current, so a renamed Player moves the bound value in
 * every open Live Control as soon as the notification lands.
 */
export function useGraphicBindingData() {
	const eventStore = useEventStore();
	const playerStore = usePlayerStore();
	const matchStore = useMatchStore();
	const phaseStore = usePhaseStore();
	const roundStore = useRoundStore();
	const archetypeStore = useArchetypeStore();
	const featureMatchStore = useFeatureMatchStore();

	function byId<T extends { id: number }>(rows: readonly T[]): Record<number, T> {
		return Object.fromEntries(rows.map(row => [row.id, row]));
	}

	/**
	 * Every entity a Graphic Source Selection on this Event could name.
	 *
	 * Keyed by id rather than listed, so resolution stays a lookup: a binding never
	 * searches a collection, it reads the one entity its selection names.
	 */
	const dataSet = computed<GraphicBindingDataSet>(() => ({
		event: eventStore.event ?? null,
		players: byId(playerStore.players ?? []),
		talents: byId(eventStore.event?.talents ?? []),
		phases: byId(phaseStore.phases ?? []),
		rounds: byId(roundStore.rounds ?? []),
		matches: byId(matchStore.matches ?? []),
		featureMatchSlots: byId(featureMatchStore.featureMatches ?? []),
		archetypes: byId(archetypeStore.archetypes ?? []),
	}));

	/** What one picker offers, in the order an operator reads it. */
	function selectionOptions(kind: GraphicSourceSelectionKind): { label: string; value: number }[] {
		const data = dataSet.value;

		switch (kind) {
			case 'player':
				return Object.entries(data.players).map(([id, player]) => ({
					label: player.name ?? `Player ${id}`,
					value: Number(id),
				}));
			case 'talent':
				return Object.entries(data.talents).map(([id, talent]) => ({ label: talent.name, value: Number(id) }));
			case 'phase':
				return Object.entries(data.phases).map(([id, phase]) => ({ label: phase.name, value: Number(id) }));
			case 'round':
				return Object.entries(data.rounds).map(([id, round]) => ({ label: round.name, value: Number(id) }));
			case 'match':
				return Object.entries(data.matches).map(([id, match]) => ({
					label: [match.player1Data?.name, match.player2Data?.name].filter(Boolean).join(' vs ')
						|| `Match ${id}`,
					value: Number(id),
				}));
			case 'feature-match-slot':
				return Object.entries(data.featureMatchSlots).map(([id, slot]) => ({
					label: slot.roundName ? `Slot ${id} — ${slot.roundName}` : `Slot ${id}`,
					value: Number(id),
				}));
			case 'archetype':
				return Object.entries(data.archetypes).map(([id, archetype]) => ({
					label: archetype.name,
					value: Number(id),
				}));
			// The current Event needs no picker: it is the Event this Screen belongs to.
			case 'event':
				return [];
		}
	}

	return { dataSet, selectionOptions };
}
