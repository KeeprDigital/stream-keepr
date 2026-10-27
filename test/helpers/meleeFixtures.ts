import type { DbPlayerDeck } from '~~/server/db/schema';
import type { MatchMapperContext } from '~~/server/mappers/melee';
import type {
	MeleeMatchCompetitorParsed,
	MeleeMatchParsed,
	MeleePlayerParsed,
	MeleeStandingParsed,
} from '~~/server/schemas/external/melee';
import { externalIdentityKey } from '~~/server/mappers/melee';
import { createMockPlayer } from '~~/test/helpers/fixtures';

/** A Melee registration as the Players endpoint parses it. */
export function meleePlayer(teamId: number, overrides: Partial<MeleePlayerParsed> = {}): MeleePlayerParsed {
	return {
		TeamId: teamId,
		PlayerName: `Player ${teamId}`,
		PronounsDescription: null,
		Decklists: [],
		...overrides,
	};
}

/** A Melee standing row for `teamId`. */
export function meleeStanding(teamId: number, overrides: Partial<MeleeStandingParsed> = {}): MeleeStandingParsed {
	return {
		TeamId: teamId,
		MatchWins: 0,
		MatchLosses: 0,
		MatchDraws: 0,
		Points: 0,
		Rank: 1,
		...overrides,
	};
}

/** A Match competitor; `decklist` names the Melee deck GUID it submitted, if any. */
export function meleeCompetitor(
	teamId: number,
	overrides: Partial<MeleeMatchCompetitorParsed> & { decklist?: { id: string; formatId: string } } = {},
): MeleeMatchCompetitorParsed {
	const { decklist, ...rest } = overrides;
	return {
		TeamId: teamId,
		SortOrder: 0,
		GameWins: null,
		Decklists: decklist
			? [
					{ DecklistId: decklist.id, PlayerId: teamId, FormatId: decklist.formatId },
				]
			: [],
		...rest,
	} as MeleeMatchCompetitorParsed;
}

/** A Melee Match: an unpaired completed record unless overridden. */
export function meleeMatch(guid: string, overrides: Partial<MeleeMatchParsed> = {}): MeleeMatchParsed {
	return {
		Guid: guid,
		TableNumber: null,
		Competitors: [],
		HasResult: true,
		ResultString: null,
		GameDraws: 0,
		ByeReason: null,
		...overrides,
	} as MeleeMatchParsed;
}

/** A local Player imported from Melee `teamId`. */
export function localMeleePlayer(id: number, teamId: number, overrides: Parameters<typeof createMockPlayer>[0] = {}) {
	return createMockPlayer({
		id,
		name: `Player ${teamId}`,
		externalId: String(teamId),
		externalSource: 'melee',
		gameData: null,
		...overrides,
	});
}

/** A local Player Deck imported from Melee. */
export function localDeck(id: number, overrides: Partial<DbPlayerDeck> = {}): DbPlayerDeck {
	return {
		id,
		eventId: 1,
		playerId: 11,
		externalId: `deck-${id}`,
		externalSource: 'melee',
		formatExternalId: 'standard',
		name: `Deck ${id}`,
		colors: '',
		sortOrder: 0,
		isPrimary: false,
		archetypeId: null,
		reviewedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides,
	};
}

/** A Match mapper context knowing `players` and their decks. */
export function matchContext(
	{ players = [], decks = [], ...overrides }: Partial<MatchMapperContext> & {
		players?: ReturnType<typeof localMeleePlayer>[];
		decks?: DbPlayerDeck[];
	} = {},
): MatchMapperContext {
	const decksByPlayer = new Map<number, DbPlayerDeck[]>();
	for (const deck of decks) {
		decksByPlayer.set(deck.playerId, [
			...(decksByPlayer.get(deck.playerId) ?? []),
			deck,
		]);
	}

	return {
		playerMap: new Map(players.map(player => [
			externalIdentityKey(player.externalSource!, player.externalId!),
			player,
		])),
		recordsByTeamId: new Map(),
		playerDecksByPlayerId: decksByPlayer,
		archetypesById: new Map(),
		roundFormatExternalId: null,
		warnings: [],
		...overrides,
	};
}
