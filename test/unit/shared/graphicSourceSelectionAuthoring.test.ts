import type { BroadcastGraphicConfig, GraphicInputDeclaration } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { broadcastGraphicsModeConfigSchema } from '~~/server/schemas/api/screen';
import {
	addGraphicSourceSelection,
	canDeriveGraphicSource,
	deleteGraphicInput,
	deleteGraphicInputBinding,
	deleteGraphicSourceSelection,
	graphicSourceDerivationOptions,
	patchGraphicSourceSelection,
	setGraphicInputBinding,
	setGraphicSourceDerivation,
} from '~~/shared/modules/graphics';
import {
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
} from '~~/shared/types/graphics';

/**
 * Authoring Graphic Source Selections and Graphic Input Bindings.
 *
 * The rule every assertion here serves is that an authoring surface cannot produce
 * a Broadcast Graphic the write path refuses. The server checks a derived selection
 * against the relation table, checks the `from` chains for cycles, and allows one
 * Graphic Input Binding per Graphic Input; these operations are where the same
 * refusals happen while an author is still holding the mouse.
 */

function textInput(key: string): GraphicInputDeclaration {
	return {
		type: 'text',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		default: '',
		maxLength: 200,
	};
}

function numberInput(key: string): GraphicInputDeclaration {
	return {
		type: 'number',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		default: null,
		integer: true,
	};
}

function stack(overrides: Partial<BroadcastGraphicConfig> = {}): BroadcastGraphicConfig[] {
	return [{ id: 'lower-third', name: 'Lower Third', items: [], ...overrides }];
}

function sourcesOf(graphics: BroadcastGraphicConfig[]) {
	return graphics[0]!.sources ?? [];
}

function bindingsOf(graphics: BroadcastGraphicConfig[]) {
	return graphics[0]!.bindings ?? [];
}

const SLOT = { key: 'slot', label: 'Slot', kind: 'feature-match-slot' as const };
const MATCH = { key: 'match', label: 'Match', kind: 'match' as const };
const PLAYER = { key: 'player', label: 'Player', kind: 'player' as const };

describe('graphic Source Selection authoring', () => {
	it('declares a Graphic Source Selection of the chosen kind, keyed once and uniquely', () => {
		const once = addGraphicSourceSelection(stack(), 'lower-third', 'player');
		const twice = addGraphicSourceSelection(once, 'lower-third', 'feature-match-slot');

		expect(sourcesOf(twice)).toEqual([
			{ key: 'source-1', label: 'Source 1', kind: 'player' },
			{ key: 'source-2', label: 'Source 2', kind: 'feature-match-slot' },
		]);
	});

	it('renames a Graphic Source Selection without moving the key a binding names', () => {
		const graphics = patchGraphicSourceSelection(
			stack({ sources: [PLAYER], bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }] }),
			'lower-third',
			'player',
			{ label: 'Featured Player' },
		);

		expect(sourcesOf(graphics)).toEqual([{ key: 'player', label: 'Featured Player', kind: 'player' }]);
		expect(bindingsOf(graphics)).toEqual([{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }]);
	});

	it('takes the Graphic Input Bindings that read a removed Graphic Source Selection with it', () => {
		const graphics = deleteGraphicSourceSelection(
			stack({
				sources: [PLAYER, MATCH],
				bindings: [
					{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' },
					{ inputKey: 'table', sourceKey: 'match', fieldId: 'match.tableNumber' },
				],
			}),
			'lower-third',
			'player',
		);

		expect(sourcesOf(graphics)).toEqual([MATCH]);
		expect(bindingsOf(graphics)).toEqual([{ inputKey: 'table', sourceKey: 'match', fieldId: 'match.tableNumber' }]);
	});

	/**
	 * A derived selection whose parent no longer exists is exactly what the write
	 * path refuses, so removing the parent removes the chain that followed it rather
	 * than leaving a config an author cannot save.
	 */
	it('takes the whole derived chain with a removed Graphic Source Selection', () => {
		const graphics = deleteGraphicSourceSelection(
			stack({
				sources: [
					SLOT,
					{ key: 'p1', label: 'Player 1', kind: 'player', from: { sourceKey: 'slot', relation: 'player1' } },
					{ key: 'p1-archetype', label: 'Archetype', kind: 'archetype', from: { sourceKey: 'p1', relation: 'archetype' } },
					MATCH,
				],
				bindings: [
					{ inputKey: 'name', sourceKey: 'p1', fieldId: 'player.name' },
					{ inputKey: 'deck', sourceKey: 'p1-archetype', fieldId: 'archetype.name' },
					{ inputKey: 'table', sourceKey: 'match', fieldId: 'match.tableNumber' },
				],
			}),
			'lower-third',
			'slot',
		);

		expect(sourcesOf(graphics)).toEqual([MATCH]);
		expect(bindingsOf(graphics)).toEqual([{ inputKey: 'table', sourceKey: 'match', fieldId: 'match.tableNumber' }]);
	});

	/**
	 * The caps are the write path's, restated where an author meets them.
	 *
	 * A ninth Graphic Source Selection on one Broadcast Graphic, or a forty-first
	 * across the Screen, is a config the schema refuses — so the operation declines to
	 * produce one rather than leaving an author holding a Screen they cannot save.
	 */
	it('declares no more Graphic Source Selections than one Broadcast Graphic may hold', () => {
		const full = Array.from(
			{ length: MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC },
			(_, index) => ({ key: `source-${index}`, label: `Source ${index}`, kind: 'player' as const }),
		);
		const graphics = stack({ sources: full });

		expect(addGraphicSourceSelection(graphics, 'lower-third', 'player')).toEqual(graphics);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('declares no more across the Screen than the whole-Screen budget allows', () => {
		// The per-graphic cap is reached first on one graphic, so the Screen-wide one is
		// only reachable across several — which is exactly how an author reaches it.
		const perGraphic = MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC;
		const graphics = Array.from(
			{ length: MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN / perGraphic },
			(_, index) => ({
				id: `graphic-${index}`,
				name: `Graphic ${index}`,
				items: [],
				sources: Array.from({ length: perGraphic }, (_, entry) => ({
					key: `s${index}x${entry}`,
					label: `Source ${index}-${entry}`,
					kind: 'player' as const,
				})),
			}),
		);
		const roomy = [...graphics, { id: 'spare', name: 'Spare', items: [] }];

		expect(addGraphicSourceSelection(roomy, 'spare', 'player')).toEqual(roomy);
	});

	it('refuses a blank label, which is a Broadcast Graphic the write path rejects', () => {
		const graphics = stack({ sources: [PLAYER] });

		expect(patchGraphicSourceSelection(graphics, 'lower-third', 'player', { label: '' })).toEqual(graphics);
		expect(patchGraphicSourceSelection(graphics, 'lower-third', 'player', { label: '   ' })).toEqual(graphics);
		expect(broadcastGraphicsModeConfigSchema.safeParse({
			graphics: stack({ sources: [{ ...PLAYER, label: '' }] }),
		}).success).toBe(false);
	});

	it('leaves another Broadcast Graphic in the stack alone', () => {
		const graphics = addGraphicSourceSelection(
			[...stack(), { id: 'slate', name: 'Slate', items: [] }],
			'slate',
			'round',
		);

		expect(graphics[0]!.sources).toBeUndefined();
		expect(graphics[1]!.sources).toEqual([{ key: 'source-1', label: 'Source 1', kind: 'round' }]);
	});
});

describe('deriving one Graphic Source Selection from another', () => {
	it('offers only the relationships that yield the selection\'s own kind', () => {
		const sources = [SLOT, MATCH, { key: 'p1', label: 'Player 1', kind: 'player' as const }];

		expect(graphicSourceDerivationOptions(sources, 'p1')).toEqual([
			{ sourceKey: 'slot', relation: 'player1' },
			{ sourceKey: 'slot', relation: 'player2' },
			{ sourceKey: 'match', relation: 'player1' },
			{ sourceKey: 'match', relation: 'player2' },
		]);
	});

	it('offers nothing for a kind no relationship reaches', () => {
		const sources = [SLOT, { key: 'talent', label: 'Talent', kind: 'talent' as const }];

		// A Talent is reached only from the current Event, which is not declared here.
		expect(graphicSourceDerivationOptions(sources, 'talent')).toEqual([]);
	});

	it('never offers a Graphic Source Selection to derive from itself', () => {
		const sources = [{ key: 'match', label: 'Match', kind: 'match' as const }, SLOT];

		// A Match is reachable from a Feature Match Slot, and from nothing else here.
		expect(graphicSourceDerivationOptions(sources, 'match')).toEqual([
			{ sourceKey: 'slot', relation: 'match' },
		]);
	});

	/**
	 * The two guards below are stated against hand-written declarations rather than
	 * ones these operations produced, because neither is reachable through the current
	 * relation vocabulary: the relation table is acyclic and no relationship yields the
	 * kind it starts from. That is the same standing the resolution cycle guard and the
	 * schema's own `graphicSourceDerivationsAcyclic` have, and both are kept for the
	 * same reason — a future relationship that closes a cycle must meet a rule that is
	 * already written down. Stating them here is what makes each guard's removal
	 * visible instead of silent.
	 */
	it('never offers a Graphic Source Selection whose chain already reaches this one', () => {
		const sources = [
			{ key: 'p', label: 'Player', kind: 'player' as const },
			// `m` claims to follow `p`, which no relationship yields and these operations
			// would refuse to write. It is the shape a `from` cycle takes.
			{ key: 'm', label: 'Match', kind: 'match' as const, from: { sourceKey: 'p', relation: 'player1' as const } },
		];

		// A Match yields a Player, so nothing but the cycle guard stops `m` being offered
		// back to `p` — leaving the two following each other.
		expect(graphicSourceDerivationOptions(sources, 'p')).toEqual([]);
		expect(canDeriveGraphicSource(sources, 'p', { sourceKey: 'm', relation: 'player1' })).toBe(false);
	});

	it('never offers a Graphic Source Selection to derive from its own key', () => {
		// One key on two declarations is the only shape in which a self-derivation is
		// representable at all, since no relationship yields the kind it starts from.
		// The schema refuses the duplicate key as well; this is the other half.
		const sources = [
			{ key: 'x', label: 'Featured Player', kind: 'player' as const },
			{ key: 'x', label: 'Featured Match', kind: 'match' as const },
		];

		expect(graphicSourceDerivationOptions(sources, 'x')).toEqual([]);
		expect(canDeriveGraphicSource(sources, 'x', { sourceKey: 'x', relation: 'player1' })).toBe(false);
	});

	/**
	 * The cycle guard, enforced while authoring rather than only at resolution: a
	 * selection that already follows this one can never become the one it follows.
	 */
	it('never offers a Graphic Source Selection that already follows this one', () => {
		const sources = [
			SLOT,
			{ key: 'match', label: 'Match', kind: 'match' as const, from: { sourceKey: 'slot', relation: 'match' as const } },
			{ key: 'loose-slot', label: 'Other slot', kind: 'feature-match-slot' as const },
		];

		// Nothing yields a Feature Match Slot, so `slot` has no options at all — and in
		// particular not the Match that follows it.
		expect(graphicSourceDerivationOptions(sources, 'slot')).toEqual([]);
		expect(canDeriveGraphicSource(sources, 'slot', { sourceKey: 'match', relation: 'match' })).toBe(false);
	});

	it('stores a derivation an author may choose, and clears it back to an operator pick', () => {
		const derived = setGraphicSourceDerivation(
			stack({ sources: [SLOT, PLAYER] }),
			'lower-third',
			'player',
			{ sourceKey: 'slot', relation: 'player1' },
		);

		expect(sourcesOf(derived)[1]).toEqual({
			...PLAYER,
			from: { sourceKey: 'slot', relation: 'player1' },
		});

		const cleared = setGraphicSourceDerivation(derived, 'lower-third', 'player', undefined);
		expect(sourcesOf(cleared)[1]).toEqual(PLAYER);
	});

	it('refuses a derivation the relation table does not yield', () => {
		const graphics = stack({ sources: [{ key: 'phase', label: 'Phase', kind: 'phase' }, PLAYER] });

		// No relationship reaches a Player from a Phase, so the write path would refuse it.
		expect(setGraphicSourceDerivation(graphics, 'lower-third', 'player', { sourceKey: 'phase', relation: 'player1' }))
			.toEqual(graphics);
	});
});

describe('graphic Input Binding authoring', () => {
	const graphics = stack({
		inputs: [textInput('name'), numberInput('life')],
		sources: [PLAYER, SLOT],
	});

	it('binds one Graphic Input to one catalog field', () => {
		const bound = setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' },
			'mtg',
		);

		expect(bindingsOf(bound)).toEqual([{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }]);
	});

	it('replaces the binding a Graphic Input already had rather than adding a second', () => {
		const first = setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' },
			'mtg',
		);
		const second = setGraphicInputBinding(
			first,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.record' },
			'mtg',
		);

		expect(bindingsOf(second)).toEqual([{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.record' }]);
	});

	it('refuses a field whose type the Graphic Input cannot hold', () => {
		// `player.wins` is a number and `name` is a text Graphic Input: resolution would
		// drop it rather than coerce, so authoring never stores it.
		expect(setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.wins' },
			'mtg',
		)).toEqual(graphics);
	});

	it('refuses a field this Event\'s game does not have', () => {
		expect(setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.leader' },
			'mtg',
		)).toEqual(graphics);

		expect(bindingsOf(setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.leader' },
			'op',
		))).toEqual([{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.leader' }]);
	});

	it('refuses a field that belongs to another Graphic Source Selection kind', () => {
		// `player.name` is a catalog name, so the write path accepts it — and it would
		// then resolve nothing for as long as it existed.
		expect(setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'slot', fieldId: 'player.name' },
			'mtg',
		)).toEqual(graphics);
	});

	it('refuses a binding for a Graphic Input or Graphic Source Selection nothing declares', () => {
		expect(setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'undeclared', sourceKey: 'player', fieldId: 'player.name' },
			'mtg',
		)).toEqual(graphics);

		expect(setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'undeclared', fieldId: 'player.name' },
			'mtg',
		)).toEqual(graphics);
	});

	it('unbinds one Graphic Input without disturbing the others', () => {
		const bound = setGraphicInputBinding(
			setGraphicInputBinding(graphics, 'lower-third', { inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }, 'mtg'),
			'lower-third',
			{ inputKey: 'life', sourceKey: 'slot', fieldId: 'featureMatchSlot.player1Life' },
			'mtg',
		);

		expect(bindingsOf(deleteGraphicInputBinding(bound, 'lower-third', 'name')))
			.toEqual([{ inputKey: 'life', sourceKey: 'slot', fieldId: 'featureMatchSlot.player1Life' }]);
	});

	it('leaves nothing behind when the bound Graphic Input stops being declared', () => {
		const bound = setGraphicInputBinding(
			graphics,
			'lower-third',
			{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' },
			'mtg',
		);

		expect(bindingsOf(deleteGraphicInput(bound, 'lower-third', 'name'))).toEqual([]);
	});
});

/**
 * The same rules from the write path's side.
 *
 * The server's cross-field validation is the contract this authoring layer mirrors,
 * so these assertions state both halves together: what the operations produce parses,
 * and the configs they refuse to produce are the ones the schema rejects.
 */
describe('what the write path accepts', () => {
	it('accepts a Broadcast Graphic built entirely through these operations', () => {
		const declared = addGraphicSourceSelection(
			addGraphicSourceSelection(
				stack({ inputs: [textInput('name'), numberInput('life')] }),
				'lower-third',
				'feature-match-slot',
			),
			'lower-third',
			'player',
		);
		const derived = setGraphicSourceDerivation(
			declared,
			'lower-third',
			'source-2',
			{ sourceKey: 'source-1', relation: 'player1' },
		);
		const graphics = setGraphicInputBinding(
			setGraphicInputBinding(derived, 'lower-third', { inputKey: 'name', sourceKey: 'source-2', fieldId: 'player.name' }, 'mtg'),
			'lower-third',
			{ inputKey: 'life', sourceKey: 'source-1', fieldId: 'featureMatchSlot.player1Life' },
			'mtg',
		);

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('refuses the derivation the write path refuses, from the other side', () => {
		const sources = [
			{ key: 'phase', label: 'Phase', kind: 'phase' as const },
			{ ...PLAYER, from: { sourceKey: 'phase', relation: 'player1' as const } },
		];

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: stack({ sources }) }).success).toBe(false);
		expect(canDeriveGraphicSource(sources, 'player', { sourceKey: 'phase', relation: 'player1' })).toBe(false);
	});

	it('leaves no derived Graphic Source Selection stranded by a deletion', () => {
		const stranded = stack({
			sources: [SLOT, { ...PLAYER, from: { sourceKey: 'slot', relation: 'player1' } }],
		});

		// Removing the parent and keeping the child is exactly what the schema rejects,
		// so the deletion takes the child with it and the result parses.
		expect(broadcastGraphicsModeConfigSchema.safeParse({
			graphics: stack({ sources: [{ ...PLAYER, from: { sourceKey: 'slot', relation: 'player1' } }] }),
		}).success).toBe(false);
		expect(broadcastGraphicsModeConfigSchema.safeParse({
			graphics: deleteGraphicSourceSelection(stranded, 'lower-third', 'slot'),
		}).success).toBe(true);
	});
});
