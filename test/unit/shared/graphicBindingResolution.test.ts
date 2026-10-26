import type { GraphicBindingDataSet, GraphicBindingMatch } from '~~/shared/modules/graphics';
import type {
	GraphicInputBinding,
	GraphicInputDeclaration,
	GraphicSourceSelectionDeclaration,
} from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	createEmptyGraphicBindingDataSet,
	isOperatorSelectedGraphicSource,
	resolveGraphicBindingField,
	resolveGraphicInputBindings,
	resolveGraphicSourceSelections,
} from '~~/shared/modules/graphics';

// Selections and bindings resolving against Event Data: a derived Player reports what
// production committed to, and anything unresolvable resolves to nothing, not the default.

const NAME_INPUT: GraphicInputDeclaration = {
	type: 'text',
	key: 'name',
	label: 'Name',
	required: false,
	updatePolicy: 'staged',
	default: 'Unnamed',
	maxLength: 40,
};

const WINS_INPUT: GraphicInputDeclaration = {
	type: 'number',
	key: 'wins',
	label: 'Wins',
	required: false,
	updatePolicy: 'staged',
	default: null,
	integer: true,
};

function data(overrides: Partial<GraphicBindingDataSet> = {}): GraphicBindingDataSet {
	return {
		event: {
			name: 'Regional',
			game: 'mtg',
			displayRecordSeparator: '-',
			displayHideZeroDraws: true,
			commentator1TalentId: 5,
		},
		players: {
			1: {
				name: 'Ava Reed',
				wins: 5,
				gameData: { type: 'mtg', deckName: 'Dimir Midrange' },
			},
		},
		talents: {
			5: { name: 'Jules Kim', socialProfiles: {} },
		},
		phases: {
			20: { name: 'Swiss' },
		},
		rounds: {
			30: { name: 'Round 5', roundNumber: 5, phaseId: 20 },
		},
		matches: {
			40: {
				roundId: 30,
				tableNumber: 12,
				player1Data: { name: 'Ava R.', wins: 4 },
				player2Data: { name: 'Sam Ortiz', wins: 3 },
				hasResult: false,
				isBye: false,
			},
		},
		featureMatchSlots: {},
		archetypes: {},
		...overrides,
	};
}

const PLAYER_SOURCE: GraphicSourceSelectionDeclaration = { key: 'player', label: 'Player', kind: 'player' };
const MATCH_SOURCE: GraphicSourceSelectionDeclaration = { key: 'match', label: 'Match', kind: 'match' };
const MATCH_PLAYER1: GraphicSourceSelectionDeclaration = {
	key: 'p1',
	label: 'Player 1',
	kind: 'player',
	from: { sourceKey: 'match', relation: 'player1' },
};

function bind(inputKey: string, sourceKey: string, fieldId: string): GraphicInputBinding {
	return { inputKey, sourceKey, fieldId };
}

describe('graphic Source Selection resolution', () => {
	it('generates a picker only for the selections an operator actually makes', () => {
		expect(isOperatorSelectedGraphicSource(PLAYER_SOURCE)).toBe(true);
		expect(isOperatorSelectedGraphicSource(MATCH_PLAYER1)).toBe(false);
		expect(isOperatorSelectedGraphicSource({ key: 'event', label: 'Event', kind: 'event' })).toBe(false);
	});

	it('resolves the current Event without anyone selecting it', () => {
		const resolved = resolveGraphicSourceSelections(
			[
				{ key: 'event', label: 'Event', kind: 'event' },
			],
			{},
			data(),
		);

		expect(resolved.event!.entity).toMatchObject({ name: 'Regional' });
	});

	it('resolves a directly selected Player from current Event Data', () => {
		const resolved = resolveGraphicSourceSelections([PLAYER_SOURCE], { player: 1 }, data());

		expect(resolved.player!.entity).toMatchObject({ name: 'Ava Reed' });
	});

	it('resolves a Player derived from a Match out of that Match\'s production snapshot', () => {
		const resolved = resolveGraphicSourceSelections([MATCH_SOURCE, MATCH_PLAYER1], { match: 40 }, data());

		// The Match's own snapshot said "Ava R.", and the live Event Player is "Ava
		// Reed". Production committed to the snapshot, so that is what resolves.
		expect(resolved.p1!.entity).toMatchObject({ name: 'Ava R.' });
	});

	it('resolves nothing for a Player derived from a Match nobody has selected', () => {
		const resolved = resolveGraphicSourceSelections([MATCH_SOURCE, MATCH_PLAYER1], {}, data());

		expect(resolved.p1!.entity).toBeUndefined();
	});

	it('resolves nothing for a relationship the parent kind does not offer', () => {
		const resolved = resolveGraphicSourceSelections(
			[
				PLAYER_SOURCE,
				{
					key: 'nope',
					label: 'Nope',
					kind: 'player',
					from: { sourceKey: 'player', relation: 'player1' },
				},
			],
			{ player: 1 },
			data(),
		);

		expect(resolved.nope!.entity).toBeUndefined();
	});

	it('terminates on a derived chain that loops back on itself', () => {
		const resolved = resolveGraphicSourceSelections(
			[
				{
					key: 'a',
					label: 'A',
					kind: 'player',
					from: { sourceKey: 'b', relation: 'player1' },
				},
				{
					key: 'b',
					label: 'B',
					kind: 'match',
					from: { sourceKey: 'a', relation: 'player1' },
				},
			],
			{},
			data(),
		);

		// Both resolve nothing and resolution returns rather than recursing. Note *why* it
		// returns: today the relation table is acyclic by construction, so the kind check
		// refuses this chain before the visiting guard is consulted. The guard is defence
		// for a relation table that stops being acyclic, not the thing this proves.
		expect(resolved.a!.entity).toBeUndefined();
		expect(resolved.b!.entity).toBeUndefined();
	});
});

describe('graphic Input Binding resolution', () => {
	it('resolves one bound value per binding from the selected entity', () => {
		const bound = resolveGraphicInputBindings(
			{
				inputs: [NAME_INPUT, WINS_INPUT],
				sources: [PLAYER_SOURCE],
				bindings: [
					bind('name', 'player', 'player.name'),
					bind('wins', 'player', 'player.wins'),
				],
			},
			{ player: 1 },
			data(),
		);

		expect(bound).toEqual({ name: 'Ava Reed', wins: 5 });
	});

	it('contributes no value at all when its Graphic Source Selection resolves nothing', () => {
		const bound = resolveGraphicInputBindings(
			{
				inputs: [NAME_INPUT],
				sources: [PLAYER_SOURCE],
				bindings: [
					bind('name', 'player', 'player.name'),
				],
			},
			{},
			data(),
		);

		// Not the declared default, and not an empty string: absent, so every caller
		// treats it as a binding that cannot go on air.
		expect('name' in bound).toBe(false);
	});

	it('contributes no value for a field this Event\'s game does not have', () => {
		const graphic = {
			inputs: [NAME_INPUT],
			sources: [PLAYER_SOURCE],
			bindings: [
				bind('name', 'player', 'player.deckName'),
			],
		};

		expect(resolveGraphicInputBindings(graphic, { player: 1 }, data()))
			.toEqual({ name: 'Dimir Midrange' });
		expect(resolveGraphicInputBindings(graphic, { player: 1 }, data({
			event: { name: 'Regional', game: 'op' },
		}))).toEqual({});
	});

	it('contributes no value when the field\'s type is not the Graphic Input\'s', () => {
		const bound = resolveGraphicInputBindings(
			{
				inputs: [NAME_INPUT],
				sources: [PLAYER_SOURCE],
				bindings: [
					bind('name', 'player', 'player.wins'),
				],
			},
			{ player: 1 },
			data(),
		);

		expect(bound).toEqual({});
	});

	it('resolves a derived Player\'s fields through the production snapshot', () => {
		const bound = resolveGraphicInputBindings(
			{
				inputs: [NAME_INPUT, WINS_INPUT],
				sources: [MATCH_SOURCE, MATCH_PLAYER1],
				bindings: [
					bind('name', 'p1', 'player.name'),
					bind('wins', 'p1', 'player.wins'),
				],
			},
			{ match: 40 },
			data(),
		);

		expect(bound).toEqual({ name: 'Ava R.', wins: 4 });
	});

	it('lets several bindings share one Graphic Source Selection', () => {
		const bound = resolveGraphicInputBindings(
			{
				inputs: [
					NAME_INPUT,
					{
						...WINS_INPUT,
						key: 'record',
						type: 'text',
						default: '',
						maxLength: 20,
					} as GraphicInputDeclaration,
				],
				sources: [PLAYER_SOURCE],
				bindings: [
					bind('name', 'player', 'player.name'),
					bind('record', 'player', 'player.record'),
				],
			},
			{ player: 1 },
			data(),
		);

		expect(bound).toEqual({ name: 'Ava Reed', record: '5-0' });
	});

	it('reads a Feature Match Slot\'s live scalars from its active session', () => {
		const slotData = data({
			featureMatchSlots: {
				60: {
					matchId: 40,
					tableNumber: 3,
					player1Data: { name: 'Stale Name' },
					activeSession: {
						sourceSnapshot: {
							tableNumber: 9,
							player1: {
								data: { name: 'Ava R.' },
							},
						},
						currentState: {
							player1: {
								lifeTotal: 17,
								gameWins: 1,
								counters: [],
								sideboardRevealed: false,
							},
							player2: {
								lifeTotal: 20,
								gameWins: 0,
								counters: [],
								sideboardRevealed: false,
							},
							clock: {
								type: 'countdown',
								durationMs: 0,
								elapsedMs: 0,
								isRunning: false,
								lastStartedAt: null,
								countUpAfterCountdown: false,
							},
							currentGame: 2,
							turnNumber: 4,
							isComplete: false,
						},
					},
				},
			},
		});
		const slotSource: GraphicSourceSelectionDeclaration = { key: 'slot', label: 'Slot', kind: 'feature-match-slot' };

		const bound = resolveGraphicInputBindings(
			{
				inputs: [
					{ ...WINS_INPUT, key: 'life' },
					{ ...NAME_INPUT, key: 'table' },
					{ ...NAME_INPUT, key: 'name' },
				],
				sources: [
					slotSource,
					{
						key: 'slotP1',
						label: 'Slot Player 1',
						kind: 'player',
						from: { sourceKey: 'slot', relation: 'player1' },
					},
				],
				bindings: [
					bind('life', 'slot', 'featureMatchSlot.player1Life'),
					bind('table', 'slot', 'featureMatchSlot.tableLabel'),
					bind('name', 'slotP1', 'player.name'),
				],
			},
			{ slot: 60 },
			slotData,
		);

		// Live scalar from the session's current state, identity from its source
		// snapshot — including the table number, which the snapshot overrides.
		expect(bound).toEqual({ life: 17, table: 'Table 9', name: 'Ava R.' });
	});
});

describe('the Match result binding', () => {
	const result = (match: Partial<GraphicBindingMatch>) =>
		resolveGraphicBindingField('match', 'match.result', { roundId: 1, ...match }, createEmptyGraphicBindingDataSet());

	it('reads a reported Match\'s Game Score from player 1\'s side', () => {
		expect(result({
			hasResult: true,
			player1GameWins: 2,
			player2GameWins: 0,
			gameDraws: 0,
		})).toBe('2-0');
		expect(result({
			hasResult: true,
			player1GameWins: 1,
			player2GameWins: 1,
			gameDraws: 1,
		})).toBe('1-1-1');
	});

	it('resolves nothing for an unreported Match or a bye', () => {
		expect(result({ hasResult: false, player1GameWins: null, player2GameWins: null })).toBeUndefined();
		expect(result({
			hasResult: true,
			isBye: true,
			player1GameWins: null,
			player2GameWins: null,
		})).toBeUndefined();
	});
});
