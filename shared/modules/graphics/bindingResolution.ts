import type { Game } from '../../types/enums';
import type {
	GraphicInputBinding,
	GraphicInputDeclaration,
	GraphicInputValue,
	GraphicSourceDerivation,
	GraphicSourceRelation,
	GraphicSourceSelectionDeclaration,
	GraphicSourceSelectionKind,
} from '../../types/graphics';
import type {
	GraphicBindingDataSet,
	GraphicBindingFeatureMatchSlot,
	GraphicBindingMatch,
	GraphicBindingPlayer,
	GraphicBindingRound,
} from './bindingCatalog';
import { graphicBindingField, resolveGraphicBindingField } from './bindingCatalog';

/**
 * Resolving Graphic Source Selections and Graphic Input Bindings against Event Data.
 *
 * One pure function of authored declarations, the operator's selections, and a
 * snapshot of the entities those selections name. The server hands it entities
 * loaded from the database and Live Control hands it entities from its Event Data
 * stores, and both get the same answer — which is the only reason an operator's
 * "latest bound value" and what acceptance actually puts on air can be trusted to
 * agree.
 *
 * ## Absent means unavailable
 *
 * A binding that resolves nothing contributes no key at all. It never contributes
 * the Graphic Input's declared default: falling back would put an authored
 * placeholder on air under the appearance of live data, which is exactly the
 * failure the settled rule forbids. Every reason a binding can fail — no selection,
 * a deleted entity, a field this Event's game does not have, a type the input
 * cannot hold, an entity with no value for the field — produces the same absence.
 *
 * ## Derived selections read production snapshots
 *
 * A directly selected Player follows current Event Data. A Player reached by a
 * fixed relationship from a Match or Feature Match Slot resolves from that
 * production snapshot instead, because that is what production is showing: a
 * re-paired Match must not silently rename the player in a lower third that is
 * already on air.
 */

/** Which entity ids the operator has selected, per Graphic Source Selection key. */
export type GraphicSourceSelectionsState = Readonly<Record<string, number>>;

/** What one Graphic Source Selection currently resolves. */
export interface ResolvedGraphicSource {
	key: string;
	kind: GraphicSourceSelectionKind;
	/** Absent when nothing is selected, or when the selection no longer resolves. */
	entity?: unknown;
}

/**
 * The kind each fixed relationship yields from each parent kind.
 *
 * A relationship is available only where it is written here, so an author cannot
 * reach a Player from a Phase or a Phase from an Archetype. The declared kind of the
 * derived selection has to match, which is what stops a mis-declared relationship
 * resolving an entity of the wrong shape into the catalog.
 */
const RELATION_RESULT_KIND: Partial<Record<
	GraphicSourceSelectionKind,
	Partial<Record<GraphicSourceRelation, GraphicSourceSelectionKind>>
>> = {
	'event': { commentator1: 'talent', commentator2: 'talent' },
	'player': { archetype: 'archetype' },
	'round': { phase: 'phase' },
	'match': { player1: 'player', player2: 'player', round: 'round' },
	'feature-match-slot': { player1: 'player', player2: 'player', match: 'match' },
};

/** The relationships a Graphic Source Selection of this kind can be followed by. */
export function graphicSourceRelations(kind: GraphicSourceSelectionKind): GraphicSourceRelation[] {
	return Object.keys(RELATION_RESULT_KIND[kind] ?? {}) as GraphicSourceRelation[];
}

/**
 * What an author reads when choosing a fixed relationship to follow.
 *
 * The two Event relationships are stored as `commentator1` and `commentator2` and
 * read as Talent, which is the glossary's term for an Event's broadcast presenter or
 * commentator — and the kind they resolve. The stored names are the wire's and stay
 * as they are; an author reads the domain's.
 */
export const GRAPHIC_SOURCE_RELATION_LABELS: Record<GraphicSourceRelation, string> = {
	player1: 'Player 1',
	player2: 'Player 2',
	match: 'Match',
	round: 'Round',
	phase: 'Phase',
	archetype: 'Archetype',
	commentator1: 'Talent 1',
	commentator2: 'Talent 2',
};

/** The kind one relationship from this kind resolves, if the relationship exists. */
export function graphicSourceRelationKind(
	kind: GraphicSourceSelectionKind,
	relation: GraphicSourceRelation,
): GraphicSourceSelectionKind | undefined {
	return RELATION_RESULT_KIND[kind]?.[relation];
}

/**
 * Whether an operator picks this Graphic Source Selection.
 *
 * The current Event needs no picking and a derived selection follows another, so
 * neither generates a picker in Live Control — only a selection an operator is
 * actually asked to make does.
 */
export function isOperatorSelectedGraphicSource(
	declaration: GraphicSourceSelectionDeclaration,
): boolean {
	return declaration.kind !== 'event' && declaration.from === undefined;
}

/** Whether one Graphic Source Selection's `from` chain reaches another. */
function derivesFrom(
	sources: readonly GraphicSourceSelectionDeclaration[],
	key: string,
	ancestorKey: string,
): boolean {
	const byKey = new Map(sources.map(source => [source.key, source]));
	const seen = new Set<string>([key]);
	let current = byKey.get(key)?.from?.sourceKey;

	while (current !== undefined) {
		if (current === ancestorKey)
			return true;
		// An already-authored cycle stops the walk rather than spinning in it: this
		// function answers a question about a broken declaration as readily as a sound one.
		if (seen.has(current))
			return false;
		seen.add(current);
		current = byKey.get(current)?.from?.sourceKey;
	}

	return false;
}

/**
 * The derivations one Graphic Source Selection may actually be given.
 *
 * Every rule the write path checks a `from` against, offered as a list instead: the
 * parent is a declared sibling, the relationship is one that parent's kind offers,
 * it yields this selection's own declared kind, and it does not close a cycle. An
 * author choosing from this list cannot author a derivation the server refuses, and
 * a selection whose kind nothing reaches simply has no derivation to choose.
 */
export function graphicSourceDerivationOptions(
	sources: readonly GraphicSourceSelectionDeclaration[],
	key: string,
): GraphicSourceDerivation[] {
	const declaration = sources.find(source => source.key === key);
	if (!declaration)
		return [];

	return sources.flatMap(parent =>
		parent.key === key || derivesFrom(sources, parent.key, key)
			? []
			: graphicSourceRelations(parent.kind)
					.filter(relation => graphicSourceRelationKind(parent.kind, relation) === declaration.kind)
					.map(relation => ({ sourceKey: parent.key, relation })),
	);
}

/** Whether one derivation is among the ones this Graphic Source Selection may be given. */
export function canDeriveGraphicSource(
	sources: readonly GraphicSourceSelectionDeclaration[],
	key: string,
	from: GraphicSourceDerivation,
): boolean {
	return graphicSourceDerivationOptions(sources, key)
		.some(option => option.sourceKey === from.sourceKey && option.relation === from.relation);
}

/** A Player as one side of a Match's production snapshot. */
function matchSidePlayer(
	match: GraphicBindingMatch,
	relation: 'player1' | 'player2',
): GraphicBindingPlayer | undefined {
	const data = relation === 'player1' ? match.player1Data : match.player2Data;
	return data ?? undefined;
}

/**
 * A Player as one side of a Feature Match Slot.
 *
 * From the active Feature Match Session's source snapshot while one is running,
 * because that is the identity production committed to; from the slot's own
 * snapshot otherwise.
 */
function slotSidePlayer(
	slot: GraphicBindingFeatureMatchSlot,
	relation: 'player1' | 'player2',
): GraphicBindingPlayer | undefined {
	const snapshot = slot.activeSession?.sourceSnapshot;
	if (snapshot) {
		const side = relation === 'player1' ? snapshot.player1 : snapshot.player2;
		return side?.data ?? undefined;
	}
	const data = relation === 'player1' ? slot.player1Data : slot.player2Data;
	return data ?? undefined;
}

function entityById<TEntity>(
	table: Readonly<Record<number, TEntity>>,
	id: number | null | undefined,
): TEntity | undefined {
	if (typeof id !== 'number' || !Number.isFinite(id))
		return undefined;
	return table[id];
}

/** The entity one relationship reaches from a resolved parent entity. */
function followRelation(
	parentKind: GraphicSourceSelectionKind,
	parentEntity: unknown,
	relation: GraphicSourceRelation,
	data: GraphicBindingDataSet,
): unknown {
	switch (parentKind) {
		case 'event': {
			const event = data.event;
			if (!event)
				return undefined;
			const talentId = relation === 'commentator1' ? event.commentator1TalentId : event.commentator2TalentId;
			return entityById(data.talents, talentId);
		}
		case 'player': {
			const player = parentEntity as GraphicBindingPlayer;
			return entityById(data.archetypes, player.archetypeId);
		}
		case 'round': {
			const round = parentEntity as GraphicBindingRound;
			return entityById(data.phases, round.phaseId);
		}
		case 'match': {
			const match = parentEntity as GraphicBindingMatch;
			if (relation === 'round')
				return entityById(data.rounds, match.roundId);
			return matchSidePlayer(match, relation as 'player1' | 'player2');
		}
		case 'feature-match-slot': {
			const slot = parentEntity as GraphicBindingFeatureMatchSlot;
			if (relation === 'match')
				return entityById(data.matches, slot.matchId);
			return slotSidePlayer(slot, relation as 'player1' | 'player2');
		}
		default:
			return undefined;
	}
}

/** The entity an operator-selected Graphic Source Selection names, if it still exists. */
function selectedEntity(
	declaration: GraphicSourceSelectionDeclaration,
	selections: GraphicSourceSelectionsState,
	data: GraphicBindingDataSet,
): unknown {
	const selectedId = selections[declaration.key];

	switch (declaration.kind) {
		case 'event':
			return data.event ?? undefined;
		case 'player':
			return entityById(data.players, selectedId);
		case 'talent':
			return entityById(data.talents, selectedId);
		case 'phase':
			return entityById(data.phases, selectedId);
		case 'round':
			return entityById(data.rounds, selectedId);
		case 'match':
			return entityById(data.matches, selectedId);
		case 'feature-match-slot':
			return entityById(data.featureMatchSlots, selectedId);
		case 'archetype':
			return entityById(data.archetypes, selectedId);
	}
}

/**
 * What every declared Graphic Source Selection currently resolves.
 *
 * Derived selections are resolved by following their parent, and a chain that
 * revisits a key stops rather than recursing: an authored `from` cycle is a broken
 * declaration, not a reason for resolution to hang.
 */
export function resolveGraphicSourceSelections(
	declarations: readonly GraphicSourceSelectionDeclaration[] | undefined,
	selections: GraphicSourceSelectionsState,
	data: GraphicBindingDataSet,
): Record<string, ResolvedGraphicSource> {
	const byKey = new Map((declarations ?? []).map(declaration => [declaration.key, declaration]));
	const resolved: Record<string, ResolvedGraphicSource> = {};

	function resolveOne(
		declaration: GraphicSourceSelectionDeclaration,
		visiting: ReadonlySet<string>,
	): ResolvedGraphicSource {
		if (!declaration.from)
			return { key: declaration.key, kind: declaration.kind, entity: selectedEntity(declaration, selections, data) };

		// Unreachable while the relation table stays acyclic — the kind check below
		// refuses any loop first — and kept deliberately, because a future relation whose
		// result kind closes a cycle would otherwise recurse until the stack gave out.
		if (visiting.has(declaration.key))
			return { key: declaration.key, kind: declaration.kind };

		const parent = byKey.get(declaration.from.sourceKey);
		if (!parent)
			return { key: declaration.key, kind: declaration.kind };

		// A relationship the parent kind does not offer, or one whose result is not the
		// kind this selection declares, resolves nothing: the catalog would otherwise
		// read an entity of the wrong shape.
		if (graphicSourceRelationKind(parent.kind, declaration.from.relation) !== declaration.kind)
			return { key: declaration.key, kind: declaration.kind };

		const resolvedParent = resolveOne(parent, new Set([...visiting, declaration.key]));
		if (resolvedParent.entity === undefined)
			return { key: declaration.key, kind: declaration.kind };

		return {
			key: declaration.key,
			kind: declaration.kind,
			entity: followRelation(parent.kind, resolvedParent.entity, declaration.from.relation, data),
		};
	}

	for (const declaration of declarations ?? [])
		resolved[declaration.key] = resolveOne(declaration, new Set());

	return resolved;
}

/**
 * The latest bound value of every Graphic Input this Broadcast Graphic binds.
 *
 * Only keys that actually resolved appear. A caller distinguishes "bound and
 * resolving" from "bound and unavailable" by whether the key is present, and never
 * by a sentinel value — because `null` is a legitimate value for some Graphic Input
 * types and would be indistinguishable from failure.
 */
export function resolveGraphicInputBindings(
	graphic: {
		inputs?: readonly GraphicInputDeclaration[];
		sources?: readonly GraphicSourceSelectionDeclaration[];
		bindings?: readonly GraphicInputBinding[];
	},
	selections: GraphicSourceSelectionsState,
	data: GraphicBindingDataSet,
): Record<string, GraphicInputValue> {
	const bindings = graphic.bindings ?? [];
	if (bindings.length === 0)
		return {};

	const sources = resolveGraphicSourceSelections(graphic.sources, selections, data);
	const declarations = graphic.inputs ?? [];
	const game: Game | undefined = data.event?.game;
	const bound: Record<string, GraphicInputValue> = {};

	// Resolution always knows the Event, so a game-specific field with no game to check
	// against is a fact this data set cannot support — not a reason to resolve it
	// anyway. (Authoring surfaces with no Event context are the lenient case, and that
	// leniency lives in `isGraphicBindingFieldCompatible`, not here.)

	for (const binding of bindings) {
		const declaration = declarations.find(entry => entry.key === binding.inputKey);
		const source = sources[binding.sourceKey];
		if (!declaration || !source || source.entity === undefined)
			continue;

		const field = graphicBindingField(source.kind, binding.fieldId);
		// A binding whose field this Event's game does not offer, or whose type the
		// Graphic Input cannot hold, resolves nothing rather than something coerced.
		if (!field || field.type !== declaration.type)
			continue;
		if (field.game !== undefined && field.game !== game)
			continue;

		const value = resolveGraphicBindingField(source.kind, binding.fieldId, source.entity as never, data);
		if (value !== undefined)
			bound[binding.inputKey] = value;
	}

	return bound;
}
