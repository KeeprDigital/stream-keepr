import type { MatchMapperContext } from '~~/server/mappers/melee';
import type { MeleeMatchParsed, MeleePlayerParsed, MeleeStandingParsed } from '~~/server/schemas/external/melee';
import { describe, expect, it } from 'vitest';
import {
	externalIdentityKey,
	mapMeleeMatchesToDbRows,
	mapMeleePlayersToDb,
	mapMeleePlayerToDb,
	parseAllDecklists,
	UnsupportedMeleeTeamPayloadError,
} from '~~/server/mappers/melee';

// ──────────────── mapMeleePlayersToDb ────────────────

describe('mapMeleePlayersToDb', () => {
	it('maps player fields correctly', () => {
		const players: MeleePlayerParsed[] = [
			{
				TeamId: 100,
				Status: 7,
				PlayerName: 'Reid Duke',
				PronounsDescription: 'he/him',
				Decklists: [],
			},
		];
		const standings: MeleeStandingParsed[] = [
			{ TeamId: 100, MatchWins: 5, MatchLosses: 2, MatchDraws: 0, Points: 15, Rank: 1 },
		];
		const result = mapMeleePlayersToDb(players, standings);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			externalId: '100',
			externalSource: 'melee',
			externalStatus: 7,
			name: 'Reid Duke',
			pronouns: 'he/him',
			wins: 5,
			losses: 2,
			draws: 0,
			position: 1,
			points: 15,
		});
	});

	it('preserves a missing upstream status as null', () => {
		const result = mapMeleePlayersToDb([
			{ TeamId: 1, PlayerName: 'Player', PronounsDescription: null, Decklists: [] },
		], []);

		expect(result[0]?.externalStatus).toBeNull();
	});

	it('rejects team payloads that would collapse multiple players into one TeamId', () => {
		expect(() => mapMeleePlayersToDb([
			{ TeamId: 10, PlayerName: 'Team Member One', PronounsDescription: null, Decklists: [] },
			{ TeamId: 10, PlayerName: 'Team Member Two', PronounsDescription: null, Decklists: [] },
		], [])).toThrowError(UnsupportedMeleeTeamPayloadError);

		try {
			mapMeleePlayersToDb([
				{ TeamId: 10, PlayerName: 'Team Member One', PronounsDescription: null, Decklists: [] },
				{ TeamId: 10, PlayerName: 'Team Member Two', PronounsDescription: null, Decklists: [] },
			], []);
		}
		catch (error) {
			expect(error).toMatchObject({
				statusCode: 422,
				statusMessage: 'Unsupported Melee team tournament',
			});
		}
	});

	it('rejects duplicate TeamIds in the current standings snapshot', () => {
		expect(() => mapMeleePlayersToDb(
			[{ TeamId: 10, PlayerName: 'Player', PronounsDescription: null, Decklists: [] }],
			[
				{ TeamId: 10, MatchWins: 3, MatchLosses: 0, MatchDraws: 0, Points: 9, Rank: 1 },
				{ TeamId: 10, MatchWins: 2, MatchLosses: 1, MatchDraws: 0, Points: 6, Rank: 2 },
			],
		)).toThrow('Duplicate current Melee standing TeamId: 10');
	});

	it('sorts players by position (rank)', () => {
		const players: MeleePlayerParsed[] = [
			{ TeamId: 1, PlayerName: 'Third', PronounsDescription: null, Decklists: [] },
			{ TeamId: 2, PlayerName: 'First', PronounsDescription: null, Decklists: [] },
			{ TeamId: 3, PlayerName: 'Second', PronounsDescription: null, Decklists: [] },
		];
		const standings: MeleeStandingParsed[] = [
			{ TeamId: 1, MatchWins: 3, MatchLosses: 4, MatchDraws: 0, Points: 9, Rank: 3 },
			{ TeamId: 2, MatchWins: 6, MatchLosses: 1, MatchDraws: 0, Points: 18, Rank: 1 },
			{ TeamId: 3, MatchWins: 5, MatchLosses: 2, MatchDraws: 0, Points: 15, Rank: 2 },
		];
		const result = mapMeleePlayersToDb(players, standings);

		expect(result.map(p => p.name)).toEqual(['First', 'Second', 'Third']);
		expect(result.map(p => p.position)).toEqual([1, 2, 3]);
	});

	it('places players without standings at the end', () => {
		const players: MeleePlayerParsed[] = [
			{ TeamId: 1, PlayerName: 'No Ranking', PronounsDescription: null, Decklists: [] },
			{ TeamId: 2, PlayerName: 'Ranked', PronounsDescription: null, Decklists: [] },
		];
		const standings: MeleeStandingParsed[] = [
			{ TeamId: 2, MatchWins: 3, MatchLosses: 0, MatchDraws: 0, Points: 9, Rank: 1 },
		];
		const result = mapMeleePlayersToDb(players, standings);

		expect(result[0].name).toBe('Ranked');
		expect(result[0].position).toBe(1);
		expect(result[1].name).toBe('No Ranking');
		expect(result[1].position).toBeNull();
	});

	it('converts TeamId to string for externalId', () => {
		const players: MeleePlayerParsed[] = [
			{ TeamId: 42, PlayerName: 'Player', PronounsDescription: null, Decklists: [] },
		];
		const result = mapMeleePlayersToDb(players, []);

		expect(result[0].externalId).toBe('42');
	});

	it('sets externalSource to melee for all players', () => {
		const players: MeleePlayerParsed[] = [
			{ TeamId: 1, PlayerName: 'A', PronounsDescription: null, Decklists: [] },
			{ TeamId: 2, PlayerName: 'B', PronounsDescription: null, Decklists: [] },
		];
		const result = mapMeleePlayersToDb(players, []);

		expect(result.every(p => p.externalSource === 'melee')).toBe(true);
	});

	it('maps null pronouns when not provided', () => {
		const players: MeleePlayerParsed[] = [
			{ TeamId: 1, PlayerName: 'Player', PronounsDescription: null, Decklists: [] },
		];
		const result = mapMeleePlayersToDb(players, []);

		expect(result[0].pronouns).toBeNull();
	});

	it('sets deckLists to undefined when player has no decklists', () => {
		const players: MeleePlayerParsed[] = [
			{ TeamId: 1, PlayerName: 'Player', PronounsDescription: null, Decklists: [] },
		];
		const result = mapMeleePlayersToDb(players, []);

		expect(result[0].deckLists).toBeUndefined();
	});

	it('maps standing fields when no standing exists for player', () => {
		const players: MeleePlayerParsed[] = [
			{ TeamId: 999, PlayerName: 'Unranked', PronounsDescription: null, Decklists: [] },
		];
		const result = mapMeleePlayersToDb(players, []);

		expect(result[0].wins).toBeNull();
		expect(result[0].losses).toBeNull();
		expect(result[0].draws).toBeNull();
		expect(result[0].position).toBeNull();
		expect(result[0].points).toBeNull();
	});
});

// ──────────────── parseAllDecklists ────────────────

describe('parseAllDecklists', () => {
	it('returns undefined for undefined input', () => {
		const result = parseAllDecklists(undefined);

		expect(result).toBeUndefined();
	});

	it('returns undefined for empty array', () => {
		const result = parseAllDecklists([]);

		expect(result).toBeUndefined();
	});

	it('parses decklists into ParsedDeckList format', () => {
		const decklists = [{
			Guid: 'deck-42',
			FormatId: '42',
			DecklistName: 'Azorius Control',
			Records: [
				{ l: 'teferi', n: 'Teferi', s: 'WAR', q: 4, c: 0, t: 'Planeswalker' },
			],
			Attributes: [
				{ k: 'COLOR_WHITE', v: 'True', p: null },
				{ k: 'COLOR_BLUE', v: 'True', p: null },
			],
		}];

		const result = parseAllDecklists(decklists as any);

		expect(result).toHaveLength(1);
		expect(result![0].externalId).toBe('deck-42');
		expect(result![0].formatId).toBe('42');
		expect(result![0].name).toBe('Azorius Control');
		expect(result![0].colors).toBe('WU');
		expect(result![0].cards).toHaveLength(1);
		expect(result![0].companion).toBeNull();
	});

	it('parses companion records into companion metadata', () => {
		const decklists = [{
			Guid: 'deck-companion',
			FormatId: '42',
			DecklistName: 'Izzet Control (Lutri)',
			Records: [
				{ l: 'bolt', n: 'Lightning Bolt', s: null, q: 1, c: 0, t: 'Instant' },
				{ l: 'lutri', n: 'Lutri, the Spellchaser', s: null, q: 1, c: 4, t: 'Creature' },
			],
			Attributes: [],
		}];

		const result = parseAllDecklists(decklists as any);

		expect(result?.[0]?.cards).toHaveLength(1);
		expect(result?.[0]?.companion?.name).toBe('Lutri, the Spellchaser');
	});

	it('maps colorless decks to C', () => {
		const decklists = [{
			Guid: 'deck-colourless',
			FormatId: '1',
			DecklistName: 'Colorless Eldrazi',
			Records: [],
			Attributes: [],
		}];

		const result = parseAllDecklists(decklists as any);

		expect(result![0].colors).toBe('C');
	});
});

// ──────────────── mapMeleePlayerToDb (singular) ────────────────

describe('mapMeleePlayerToDb', () => {
	it('maps a single player without standing', () => {
		const player: MeleePlayerParsed = {
			TeamId: 42,
			PlayerName: 'Test Player',
			PronounsDescription: 'they/them',
			Decklists: [],
		};

		const result = mapMeleePlayerToDb(player);

		expect(result.externalId).toBe('42');
		expect(result.externalSource).toBe('melee');
		expect(result.name).toBe('Test Player');
		expect(result.pronouns).toBe('they/them');
		expect(result.wins).toBeNull();
		expect(result.losses).toBeNull();
		expect(result.position).toBeNull();
	});

	it('normalizes imported player name casing', () => {
		const player: MeleePlayerParsed = {
			TeamId: 42,
			PlayerName: 'test player',
			PronounsDescription: null,
			Decklists: [],
		};

		const result = mapMeleePlayerToDb(player);

		expect(result.name).toBe('Test Player');
	});

	it('maps a single player with standing', () => {
		const player: MeleePlayerParsed = {
			TeamId: 42,
			PlayerName: 'Test Player',
			PronounsDescription: null,
			Decklists: [],
		};
		const standing: MeleeStandingParsed = {
			TeamId: 42,
			MatchWins: 5,
			MatchLosses: 2,
			MatchDraws: 1,
			Points: 16,
			Rank: 3,
		};

		const result = mapMeleePlayerToDb(player, standing);

		expect(result.wins).toBe(5);
		expect(result.losses).toBe(2);
		expect(result.draws).toBe(1);
		expect(result.points).toBe(16);
		expect(result.position).toBe(3);
	});
});

// ──────────────── mapMeleeMatchesToDbRows ────────────────

function createMatchContext(overrides: Partial<MatchMapperContext> = {}): MatchMapperContext {
	return {
		playerMap: new Map(),
		standingsMap: new Map(),
		playerDecksByPlayerId: new Map(),
		archetypesById: new Map(),
		roundFormatExternalId: null,
		warnings: [],
		...overrides,
	};
}

describe('mapMeleeMatchesToDbRows', () => {
	it('maps matches with eventId and sorts by table number', () => {
		const meleeMatches: Partial<MeleeMatchParsed>[] = [
			{ Guid: 'match-2', TableNumber: 2, Competitors: [], HasResult: true, ByeReason: null, GameDraws: 0 },
			{ Guid: 'match-1', TableNumber: 1, Competitors: [], HasResult: true, ByeReason: null, GameDraws: 0 },
		];
		const context = createMatchContext();

		const result = mapMeleeMatchesToDbRows(meleeMatches as MeleeMatchParsed[], 10, 1, context);

		expect(result).toHaveLength(2);
		expect(result[0].eventId).toBe(1);
		expect(result[0].roundId).toBe(10);
		// Table 1 first
		expect(result[0].externalId).toBe('match-1');
		expect(result[1].externalId).toBe('match-2');
	});

	it('sorts byes (null table number) to the end', () => {
		const meleeMatches: Partial<MeleeMatchParsed>[] = [
			{ Guid: 'bye', TableNumber: 0, Competitors: [], HasResult: false, ByeReason: 1, GameDraws: 0 },
			{ Guid: 'match-1', TableNumber: 1, Competitors: [], HasResult: true, ByeReason: null, GameDraws: 0 },
		];
		const context = createMatchContext();

		const result = mapMeleeMatchesToDbRows(meleeMatches as MeleeMatchParsed[], 10, 1, context);

		expect(result[0].externalId).toBe('match-1');
		expect(result[1].externalId).toBe('bye');
		expect(result[1].isBye).toBe(true);
	});

	it('assigns sequential sortOrder', () => {
		const meleeMatches: Partial<MeleeMatchParsed>[] = [
			{ Guid: 'a', TableNumber: 1, Competitors: [], HasResult: true, ByeReason: null, GameDraws: 0 },
			{ Guid: 'b', TableNumber: 2, Competitors: [], HasResult: true, ByeReason: null, GameDraws: 0 },
			{ Guid: 'c', TableNumber: 3, Competitors: [], HasResult: true, ByeReason: null, GameDraws: 0 },
		];
		const context = createMatchContext();

		const result = mapMeleeMatchesToDbRows(meleeMatches as MeleeMatchParsed[], 10, 1, context);

		expect(result[0].sortOrder).toBe(0);
		expect(result[1].sortOrder).toBe(1);
		expect(result[2].sortOrder).toBe(2);
	});

	it('returns empty array for empty input', () => {
		const context = createMatchContext();

		const result = mapMeleeMatchesToDbRows([], 10, 1, context);

		expect(result).toEqual([]);
	});

	it('rejects unpaired partial Matches while preserving explicit completed and bye records', () => {
		const player = { id: 11, name: 'Player', externalId: '1', externalSource: 'melee' } as any;
		const context = createMatchContext({
			playerMap: new Map([[externalIdentityKey('melee', '1'), player]]),
		});

		expect(() => mapMeleeMatchesToDbRows([{
			Guid: 'empty-pending',
			TableNumber: null,
			Competitors: [],
			HasResult: false,
			ResultString: null,
			GameDraws: null,
			ByeReason: null,
		}], 10, 1, context)).toThrow('not paired or explicitly completed');

		expect(() => mapMeleeMatchesToDbRows([{
			Guid: 'one-sided-pending',
			TableNumber: null,
			Competitors: [{ TeamId: 1, SortOrder: 0, GameWins: null, Decklists: [] }],
			HasResult: false,
			ResultString: null,
			GameDraws: null,
			ByeReason: null,
		}], 10, 1, context)).toThrow('not paired or explicitly completed');

		expect(mapMeleeMatchesToDbRows([{
			Guid: 'empty-completed',
			TableNumber: null,
			Competitors: [],
			HasResult: true,
			ResultString: 'Completed administratively',
			GameDraws: null,
			ByeReason: null,
		}], 10, 1, context)).toHaveLength(1);

		expect(mapMeleeMatchesToDbRows([{
			Guid: 'explicit-bye',
			TableNumber: null,
			Competitors: [{ TeamId: 1, SortOrder: 0, GameWins: null, Decklists: [] }],
			HasResult: false,
			ResultString: null,
			GameDraws: null,
			ByeReason: 1,
		}], 10, 1, context)).toHaveLength(1);
	});

	it('rejects unsupported or ambiguous competitor cardinality', () => {
		const players = [1, 2, 3].map(teamId => ({
			id: teamId,
			name: `Player ${teamId}`,
			externalId: teamId.toString(),
			externalSource: 'melee',
		} as any));
		const context = createMatchContext({
			playerMap: new Map(players.map(player => [
				externalIdentityKey('melee', player.externalId),
				player,
			])),
		});
		const base = {
			Guid: 'malformed',
			TableNumber: 1,
			HasResult: false,
			ResultString: null,
			GameDraws: 0,
			ByeReason: null,
		};

		expect(() => mapMeleeMatchesToDbRows([{
			...base,
			Competitors: players.map((player, index) => ({
				TeamId: Number(player.externalId),
				SortOrder: index,
				GameWins: null,
				Decklists: [],
			})),
		}], 10, 1, context)).toThrow('at most two are supported');

		expect(() => mapMeleeMatchesToDbRows([{
			...base,
			Competitors: [
				{ TeamId: 1, SortOrder: 0, GameWins: null, Decklists: [] },
				{ TeamId: 1, SortOrder: 1, GameWins: null, Decklists: [] },
			],
		}], 10, 1, context)).toThrow('duplicate competitor 1');
	});

	it('rejects duplicate Match identities and unknown required participants', () => {
		const completedEmptyMatch = {
			Guid: 'duplicate-match',
			TableNumber: null,
			Competitors: [],
			HasResult: true,
			ResultString: null,
			GameDraws: null,
			ByeReason: null,
		};

		expect(() => mapMeleeMatchesToDbRows([
			completedEmptyMatch,
			completedEmptyMatch,
		], 10, 1, createMatchContext())).toThrow('Duplicate Melee Match external identity');

		expect(() => mapMeleeMatchesToDbRows([{
			...completedEmptyMatch,
			Guid: 'unknown-player',
			Competitors: [{ TeamId: 999, SortOrder: 0, GameWins: null, Decklists: [] }],
			ByeReason: 1,
		}], 10, 1, createMatchContext())).toThrow('unknown Melee participant 999');
	});

	it('uses competitor SortOrder for player and score assignment', () => {
		const firstPlayer = { id: 11, name: 'First', pronouns: null, externalId: '1', externalSource: 'melee', gameData: null } as any;
		const secondPlayer = { id: 22, name: 'Second', pronouns: null, externalId: '2', externalSource: 'melee', gameData: null } as any;
		const context = createMatchContext({
			playerMap: new Map([
				[externalIdentityKey('melee', '1'), firstPlayer],
				[externalIdentityKey('melee', '2'), secondPlayer],
			]),
		});
		const matches = [{
			Guid: 'ordered-match',
			TableNumber: 1,
			HasResult: true,
			ResultString: '2-1',
			GameDraws: 0,
			ByeReason: null,
			Competitors: [
				{ TeamId: 2, SortOrder: 2, GameWins: 1, Decklists: [] },
				{ TeamId: 1, SortOrder: 1, GameWins: 2, Decklists: [] },
			],
		}];

		const [result] = mapMeleeMatchesToDbRows(matches, 10, 1, context);

		expect(result).toMatchObject({
			player1Id: 11,
			player2Id: 22,
			player1GameWins: 2,
			player2GameWins: 1,
			isBye: false,
		});
	});

	it('uses the exact Melee competitor deck GUID before same-format alternatives', () => {
		const player = {
			id: 11,
			name: 'Alice',
			pronouns: null,
			externalId: '1',
			externalSource: 'melee',
			archetypeId: 99,
			lgs: null,
			gameData: { type: 'mtg', deckName: 'Primary Deck', deckColors: 'R' },
		} as any;
		const reviewedAt = new Date('2026-07-15T00:00:00.000Z');
		const exactDeck = {
			id: 101,
			playerId: 11,
			externalId: 'deck-exact',
			externalSource: 'melee',
			formatExternalId: 'standard',
			name: 'Submitted Control',
			colors: 'U',
			sortOrder: 9,
			isPrimary: false,
			archetypeId: 7,
			reviewedAt,
		} as any;
		const otherDeck = {
			...exactDeck,
			id: 102,
			externalId: 'deck-other',
			name: 'Other Standard Deck',
			sortOrder: 0,
			archetypeId: null,
			reviewedAt: null,
		} as any;
		const context = createMatchContext({
			playerMap: new Map([[externalIdentityKey('melee', '1'), player]]),
			playerDecksByPlayerId: new Map([[11, [otherDeck, exactDeck]]]),
			archetypesById: new Map([[7, { id: 7, name: 'Reviewed Control', colors: 'WU' }]]),
			roundFormatExternalId: 'standard',
		});
		const matches = [{
			Guid: 'match-exact',
			TableNumber: 1,
			HasResult: false,
			ResultString: null,
			GameDraws: 0,
			ByeReason: 1,
			Competitors: [{
				TeamId: 1,
				SortOrder: 1,
				GameWins: null,
				Decklists: [{ DecklistId: 'deck-exact', PlayerId: 1, FormatId: 'standard' }],
			}],
		}];

		const [result] = mapMeleeMatchesToDbRows(matches, 10, 1, context);

		expect(result.player1Data).toMatchObject({
			deckId: 101,
			archetypeId: 7,
			gameData: { type: 'mtg', deckName: 'Reviewed Control', deckColors: 'WU' },
		});
		expect(context.warnings).toEqual([]);
	});

	it('uses a format fallback deterministically and warns when an exact reference is unavailable', () => {
		const player = { id: 11, name: 'Alice', externalId: '1', externalSource: 'melee', gameData: null } as any;
		const laterDeck = { id: 202, playerId: 11, externalId: 'later', externalSource: 'melee', formatExternalId: 'modern', name: 'Later', colors: 'R', sortOrder: 5, isPrimary: false, archetypeId: null, reviewedAt: null } as any;
		const firstDeck = { ...laterDeck, id: 201, externalId: 'first', name: 'First', colors: 'U', sortOrder: 1 } as any;
		const context = createMatchContext({
			playerMap: new Map([[externalIdentityKey('melee', '1'), player]]),
			playerDecksByPlayerId: new Map([[11, [laterDeck, firstDeck]]]),
			roundFormatExternalId: 'standard',
		});
		const matches = [{
			Guid: 'match-format',
			TableNumber: 1,
			HasResult: false,
			ResultString: null,
			GameDraws: 0,
			ByeReason: 1,
			FormatId: 'pioneer',
			Competitors: [{
				TeamId: 1,
				SortOrder: 1,
				GameWins: null,
				Decklists: [{ DecklistId: 'missing-deck', PlayerId: 1, FormatId: 'modern' }],
			}],
		}];

		const [result] = mapMeleeMatchesToDbRows(matches, 10, 1, context);

		expect(result.player1Data).toMatchObject({
			deckId: 201,
			archetypeId: null,
			gameData: { deckName: 'First', deckColors: 'U' },
		});
		expect(context.warnings).toEqual(expect.arrayContaining([
			expect.stringContaining('used format fallback'),
			expect.stringContaining('selected deterministically'),
		]));
	});

	it('uses the Match format before a different phase format when the competitor format has no deck', () => {
		const player = { id: 11, name: 'Alice', externalId: '1', externalSource: 'melee', gameData: null } as any;
		const matchFormatDeck = { id: 301, playerId: 11, externalId: 'modern', externalSource: 'melee', formatExternalId: 'modern', name: 'Modern Deck', colors: 'R', sortOrder: 2, isPrimary: false, archetypeId: null, reviewedAt: null } as any;
		const phaseFormatDeck = { ...matchFormatDeck, id: 302, externalId: 'standard', formatExternalId: 'standard', name: 'Standard Deck', colors: 'U', sortOrder: 0 } as any;
		const context = createMatchContext({
			playerMap: new Map([[externalIdentityKey('melee', '1'), player]]),
			playerDecksByPlayerId: new Map([[11, [phaseFormatDeck, matchFormatDeck]]]),
			roundFormatExternalId: 'standard',
		});
		const matches = [{
			Guid: 'match-specific-format',
			TableNumber: 1,
			HasResult: false,
			ResultString: null,
			GameDraws: 0,
			ByeReason: 1,
			FormatId: 'modern',
			Competitors: [{
				TeamId: 1,
				SortOrder: 1,
				GameWins: null,
				Decklists: [{ DecklistId: 'missing-deck', PlayerId: 1, FormatId: 'legacy' }],
			}],
		}];

		const [result] = mapMeleeMatchesToDbRows(matches, 10, 1, context);

		expect(result.player1Data).toMatchObject({
			deckId: 301,
			gameData: { type: 'mtg', deckName: 'Modern Deck', deckColors: 'R' },
		});
		expect(context.warnings).toEqual([
			expect.stringContaining('used format fallback'),
		]);
	});

	it('uses the primary deck as the final fallback and emits a warning', () => {
		const player = { id: 11, name: 'Alice', externalId: '1', externalSource: 'melee', gameData: null } as any;
		const primaryDeck = {
			id: 401,
			playerId: 11,
			externalId: 'primary-modern',
			externalSource: 'melee',
			formatExternalId: 'modern',
			name: 'Primary Modern',
			colors: 'G',
			sortOrder: 0,
			isPrimary: true,
			archetypeId: null,
			reviewedAt: null,
		} as any;
		const context = createMatchContext({
			playerMap: new Map([[externalIdentityKey('melee', '1'), player]]),
			playerDecksByPlayerId: new Map([[11, [primaryDeck]]]),
			roundFormatExternalId: 'standard',
		});
		const matches = [{
			Guid: 'match-primary',
			TableNumber: 1,
			HasResult: false,
			ResultString: null,
			GameDraws: 0,
			ByeReason: 1,
			Competitors: [{
				TeamId: 1,
				SortOrder: 1,
				GameWins: null,
				Decklists: [{ DecklistId: 'missing-deck', PlayerId: 1, FormatId: 'standard' }],
			}],
		}];

		const [result] = mapMeleeMatchesToDbRows(matches, 10, 1, context);

		expect(result.player1Data).toMatchObject({
			deckId: 401,
			gameData: { type: 'mtg', deckName: 'Primary Modern', deckColors: 'G' },
		});
		expect(context.warnings).toEqual([
			expect.stringContaining('used primary fallback'),
		]);
	});

	it('clears primary deck metadata when no exact, format, or primary deck can be selected', () => {
		const player = {
			id: 11,
			name: 'Alice',
			externalId: '1',
			externalSource: 'melee',
			archetypeId: 9,
			gameData: { type: 'mtg', deckName: 'Primary Leak', deckColors: 'R' },
		} as any;
		const offFormatDeck = { id: 301, playerId: 11, externalId: 'legacy', externalSource: 'melee', formatExternalId: 'legacy', name: 'Legacy', colors: 'B', sortOrder: 0, isPrimary: false, archetypeId: 9, reviewedAt: new Date() } as any;
		const context = createMatchContext({
			playerMap: new Map([[externalIdentityKey('melee', '1'), player]]),
			playerDecksByPlayerId: new Map([[11, [offFormatDeck]]]),
			roundFormatExternalId: 'standard',
		});
		const matches = [{ Guid: 'match-missing', TableNumber: 1, HasResult: false, ResultString: null, GameDraws: 0, ByeReason: 1, Competitors: [{ TeamId: 1, SortOrder: 1, GameWins: null, Decklists: [] }] }];

		const [result] = mapMeleeMatchesToDbRows(matches, 10, 1, context);

		expect(result.player1Data).toMatchObject({
			deckId: null,
			archetypeId: null,
			gameData: { type: 'mtg', deckName: null, deckColors: null },
		});
		expect(context.warnings[0]).toContain('no submitted deck');
	});

	it('never selects another source\'s deck as a Melee fallback', () => {
		const player = { id: 11, name: 'Alice', externalId: '1', externalSource: 'melee', gameData: null } as any;
		const manualDeck = {
			id: 701,
			playerId: 11,
			externalId: 'manual-deck',
			externalSource: 'manual',
			formatExternalId: 'standard',
			name: 'Manual Deck',
			colors: 'R',
			sortOrder: 0,
			isPrimary: true,
			archetypeId: null,
			reviewedAt: null,
		} as any;
		const context = createMatchContext({
			playerMap: new Map([[externalIdentityKey('melee', '1'), player]]),
			playerDecksByPlayerId: new Map([[11, [manualDeck]]]),
			roundFormatExternalId: 'standard',
		});

		const [result] = mapMeleeMatchesToDbRows([{
			Guid: 'source-safe-deck',
			TableNumber: null,
			HasResult: false,
			ResultString: null,
			GameDraws: null,
			ByeReason: 1,
			Competitors: [{
				TeamId: 1,
				SortOrder: 0,
				GameWins: null,
				Decklists: [{ DecklistId: 'manual-deck', PlayerId: 1, FormatId: 'standard' }],
			}],
		}], 10, 1, context);

		expect(result.player1Data).toMatchObject({
			deckId: null,
			gameData: { type: 'mtg', deckName: null, deckColors: null },
		});
		expect(context.warnings).toEqual(expect.arrayContaining([
			expect.stringContaining('was not available locally'),
		]));
	});
});
