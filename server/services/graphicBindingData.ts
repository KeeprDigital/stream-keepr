import type {
	GraphicBindingDataSet,
	GraphicSourceSelectionsState,
} from '~~/shared/modules/graphics';
import type {
	GraphicSourceSelectionDeclaration,
	GraphicSourceSelectionKind,
} from '~~/shared/types/graphics';
import {
	createEmptyGraphicBindingDataSet,
	graphicSourceRelationKind,
} from '~~/shared/modules/graphics';
import { archetypeService } from './archetype';
import { eventService } from './event';
import { featureMatchService } from './featureMatch';
import { matchService } from './match';
import { phaseService } from './phase';
import { playerService } from './player';
import { roundService } from './round';

/**
 * The Event Data one placed Broadcast Graphic's Graphic Source Selections resolve
 * against, loaded from the database.
 *
 * ## Why the server resolves bindings at all
 *
 * Acceptance is authoritative: what a Take or an Update Graphic puts on air is
 * decided by the server, so the server has to know what each Graphic Input Binding
 * resolves at that moment. A client-supplied bound value would make the value on
 * air a client's claim about Event Data rather than a fact about it.
 *
 * ## Why it loads only what is selected
 *
 * A Graphic Source Selection is single-entity, so this loads the entities some
 * selection actually names — never a collection a binding could search. The small
 * Event-wide lists (Talents, Archetypes, Phases, Rounds) are loaded whole only when
 * a declared selection or one of its relationships can reach them, because they are
 * bounded per Event and reaching them one id at a time would cost more queries than
 * the whole list does.
 */

/** Every kind a graphic's declarations can reach, following fixed relationships. */
function reachableKinds(
	declarations: readonly GraphicSourceSelectionDeclaration[],
): Set<GraphicSourceSelectionKind> {
	const kinds = new Set<GraphicSourceSelectionKind>();
	for (const declaration of declarations) {
		kinds.add(declaration.kind);
		for (const other of declarations) {
			const derived = other.from && graphicSourceRelationKind(declaration.kind, other.from.relation);
			if (derived)
				kinds.add(derived);
		}
	}
	return kinds;
}

/** The ids an operator has selected for the declarations of one kind. */
function selectedIds(
	declarations: readonly GraphicSourceSelectionDeclaration[],
	selections: GraphicSourceSelectionsState,
	kind: GraphicSourceSelectionKind,
): number[] {
	const ids = declarations
		.filter(declaration => declaration.kind === kind && declaration.from === undefined)
		.map(declaration => selections[declaration.key])
		.filter((id): id is number => typeof id === 'number');
	return [...new Set(ids)];
}

function byId<T extends { id: number }>(rows: readonly T[]): Record<number, T> {
	return Object.fromEntries(rows.map(row => [row.id, row]));
}

export function graphicBindingDataService() {
	const events = eventService();
	const players = playerService();
	const matches = matchService();
	const slots = featureMatchService();
	const rounds = roundService();
	const phases = phaseService();
	const archetypes = archetypeService();

	/**
	 * Load the Event Data these Graphic Source Selections name.
	 *
	 * `selections` may include ids from more than one candidate state — the command
	 * being reduced can change a selection, and a merge retry can re-reduce onto a
	 * state whose selection has moved. Loading the union means resolution finds the
	 * entity whichever of them wins. An entity that is not in the set resolves
	 * nothing, which makes the binding unavailable rather than wrong: the failure
	 * direction that holds the last accepted rendering instead of putting a guess on
	 * air.
	 */
	const load = async (
		eventId: number,
		declarations: readonly GraphicSourceSelectionDeclaration[],
		selections: GraphicSourceSelectionsState,
	): Promise<GraphicBindingDataSet> => {
		if (declarations.length === 0)
			return createEmptyGraphicBindingDataSet();

		const kinds = reachableKinds(declarations);
		const event = await events.findById(eventId);
		if (!event)
			return createEmptyGraphicBindingDataSet();

		const data: GraphicBindingDataSet = {
			...createEmptyGraphicBindingDataSet(),
			event,
			// Talents arrive with the Event, and an Event's commentators are reached by a
			// fixed relationship rather than by selection, so they are always available.
			talents: byId(event.talents ?? []),
		};

		if (kinds.has('archetype') || kinds.has('player'))
			Object.assign(data.archetypes, byId(await archetypes.findByEventId(eventId)));
		if (kinds.has('phase'))
			Object.assign(data.phases, byId(await phases.findByEventId(eventId)));
		if (kinds.has('round'))
			Object.assign(data.rounds, byId(await rounds.findByEventId(eventId)));

		for (const id of selectedIds(declarations, selections, 'player')) {
			const player = await players.findById(id, eventId);
			if (player)
				Object.assign(data.players, { [id]: player });
		}
		for (const id of selectedIds(declarations, selections, 'match')) {
			const match = await matches.findById(id, eventId);
			if (match)
				Object.assign(data.matches, { [id]: match });
		}
		for (const id of selectedIds(declarations, selections, 'feature-match-slot')) {
			const slot = await slots.findById(id, eventId);
			if (slot)
				Object.assign(data.featureMatchSlots, { [id]: slot });
		}

		// A Match reached from a Feature Match Slot, and a Round reached from a Match,
		// are the two relationships whose target is not itself selectable in bulk.
		for (const slot of Object.values(data.featureMatchSlots)) {
			const matchId = slot.matchId;
			if (typeof matchId === 'number' && !(matchId in data.matches)) {
				const match = await matches.findById(matchId, eventId);
				if (match)
					Object.assign(data.matches, { [matchId]: match });
			}
		}

		return data;
	};

	return { load };
}
