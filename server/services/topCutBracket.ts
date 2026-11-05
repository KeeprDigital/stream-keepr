import type { BracketEntrant, BracketRoundInput, ManualBracket, NamedPlayerDeckIdentity, SeededPlayer } from '~~/shared/modules/top-cut-bracket';
import type { TopCutModeConfig } from '~~/shared/screenModeConfigs/topCut';
import type { Game } from '~~/shared/types/enums';
import type { ScreenOutputMatchSide, ScreenOutputRoundMatch, ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, players } from '~~/server/db/schema';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { phaseService } from '~~/server/services/phase';
import { playerRoundStandingsService } from '~~/server/services/playerRoundStandings';
import { roundService } from '~~/server/services/round';
import { findMatchesByRound } from '~~/server/services/roundMatches';
import { deriveManualTopCutBracket, deriveTopCutBracket, EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';
import { TOP_CUT_BRACKET_SIZES, topCutBracketSource } from '~~/shared/screenModeConfigs/topCut';
import { resolvePlayerDeckIdentity } from '~~/shared/utils/gameData';
import { playerDisplayName } from '~~/shared/utils/playerName';

/**
 * What a Top Cut Bracket Screen shows beside each Player's name (#759), and
 * the bracket size its operator sets (#906).
 */
export type TopCutBracketReadOptions = Partial<Pick<TopCutModeConfig, 'showSeeds' | 'showArchetypes' | 'bracketSizeOverride'>>;

/** The most Players a bracket the operator sizes seats, so the most Seeds that can take a bye. */
const MOST_SEEDS_ON_BYES = Math.max(...TOP_CUT_BRACKET_SIZES);

/** Each of these Players' deck as a broadcast names it, absent when nothing names one. */
async function findDecks(eventId: number, playerIds: readonly number[]): Promise<Map<number, NamedPlayerDeckIdentity>> {
	if (playerIds.length === 0)
		return new Map();
	const rows = await db
		.select({
			id: players.id,
			gameData: players.gameData,
			archetypeName: archetypes.name,
			archetypeColors: archetypes.colors,
		})
		.from(players)
		.leftJoin(archetypes, eq(players.archetypeId, archetypes.id))
		.where(and(eq(players.eventId, eventId), inArray(players.id, [...playerIds])));

	const byPlayer = new Map<number, NamedPlayerDeckIdentity>();
	for (const row of rows) {
		const { name, colors } = resolvePlayerDeckIdentity(
			row.archetypeName == null
				? null
				: { name: row.archetypeName, colors: row.archetypeColors },
			row.gameData,
		);
		if (name)
			byPlayer.set(row.id, { name, colors });
	}
	return byPlayer;
}

/** Every Player of the Event these Matches seat. */
function seatedPlayerIds(matchesByRound: ReadonlyMap<number, readonly ScreenOutputRoundMatch[]>): number[] {
	const ids = new Set<number>();
	for (const match of [
		...matchesByRound.values(),
	].flat()) {
		for (const side of [match.player1, match.player2]) {
			if (side?.id != null)
				ids.add(side.id);
		}
	}
	return [...ids];
}

/**
 * A Phase's Top Cut Bracket: its Rounds in order and their Matches, derived
 * into one column per Round (#752). The Top Cut Bracket Screen Output's read. Naming
 * no Phase, or one the Event does not hold, answers no Phase and an empty
 * bracket. Each side is named as Pairings names it: its Player by their
 * current name, or the Match's own record of a side no Player holds.
 *
 * Seeds are always read, since they place the first Round and name its byes
 * (#906); each Player's seed is shown, and their deck read, only when
 * `options` asks for them (#759).
 */
export async function findPhaseBracket(
	eventId: number,
	phaseId: number | undefined,
	options: TopCutBracketReadOptions = {},
): Promise<ScreenOutputTopCutResponse> {
	const phase = phaseId
		? await phaseService().findById(phaseId, eventId)
		: undefined;
	if (!phase)
		return { phase: null, bracket: EMPTY_TOP_CUT_BRACKET };

	const rounds = await roundService().findByPhaseId(phase.id, eventId);
	const matchesByRound = await findMatchesByRound(eventId, rounds.map(round => round.id));
	const seededPlayers = await playerRoundStandingsService().findSeededPlayers(eventId, phase.id);
	const seeds = new Map(seededPlayers.map(({ playerId, seed }) => [playerId, seed]));
	const decks = options.showArchetypes
		? await findDecks(eventId, [
				...new Set([
					...seatedPlayerIds(matchesByRound),
					...seededPlayers.filter(({ seed }) => seed <= MOST_SEEDS_ON_BYES).map(({ playerId }) => playerId),
				]),
			])
		: null;

	function entrant(side: ScreenOutputMatchSide): BracketEntrant {
		const shown: BracketEntrant = { playerId: side.id, name: side.name };
		const of = <T>(byPlayer: Map<number, T>) => side.id == null
			? null
			: byPlayer.get(side.id) ?? null;
		if (options.showSeeds)
			shown.seed = of(seeds);
		if (decks)
			shown.deck = of(decks);
		return shown;
	}
	const seatedEntrant = (side: ScreenOutputMatchSide | null) => side && entrant(side);

	const bracketRounds: BracketRoundInput[] = rounds.map(round => ({
		roundId: round.id,
		name: round.name,
		matches: (matchesByRound.get(round.id) ?? []).map(match => ({
			matchId: match.matchId,
			tableNumber: match.tableNumber,
			player1: seatedEntrant(match.player1),
			player2: seatedEntrant(match.player2),
			isBye: match.isBye,
			hasResult: match.hasResult,
			player1GameWins: match.player1GameWins,
			player2GameWins: match.player2GameWins,
			gameDraws: match.gameDraws,
		})),
	}));

	return {
		phase: mapPhaseToResponse(phase),
		bracket: deriveTopCutBracket(bracketRounds, {
			size: options.bracketSizeOverride,
			seeds: seededPlayers.map(({ playerId, name, seed }): SeededPlayer => ({
				seed,
				entrant: entrant({ id: playerId, name }),
			})),
		}),
	};
}

/**
 * A Manual Bracket as its Screen shows it (ADR-0075): each Seed naming a
 * Player by that Player's current name, and one typed by its name. A Seed is
 * shown as its place in the operator's list, and a Player's deck as Top Cut
 * Bracket names one, each only when `options` asks for it. A Seed naming a
 * Player the Event no longer holds is empty.
 */
export async function findManualBracket(
	eventId: number,
	manual: ManualBracket,
	options: TopCutBracketReadOptions = {},
): Promise<ScreenOutputTopCutResponse> {
	const playerIds = [
		...new Set(manual.entrants.flatMap(entrant => entrant && 'playerId' in entrant
			? [entrant.playerId]
			: [])),
	];
	const rows = playerIds.length === 0
		? []
		: await db
				.select({ id: players.id, name: players.name, nickname: players.nickname })
				.from(players)
				.where(and(eq(players.eventId, eventId), inArray(players.id, playerIds)));
	const names = new Map(rows.map(row => [
		row.id,
		playerDisplayName(row),
	]));
	const decks = options.showArchetypes
		? await findDecks(eventId, [
				...names.keys(),
			])
		: null;

	return {
		phase: null,
		bracket: deriveManualTopCutBracket(manual, (entrant, seed) => {
			const playerId = 'playerId' in entrant
				? entrant.playerId
				: null;
			const name = playerId == null
				? 'name' in entrant
					? entrant.name
					: null
				: names.get(playerId);
			if (name == null)
				return null;
			const shown: BracketEntrant = { playerId, name };
			if (options.showSeeds)
				shown.seed = seed;
			if (decks) {
				shown.deck = playerId == null
					? null
					: decks.get(playerId) ?? null;
			}
			return shown;
		}),
	};
}

/**
 * A Top Cut Bracket Screen's bracket, from the source it reads on an Event of
 * `game` (`topCutBracketSource`): its Phase's, or its Manual Bracket.
 */
export async function findTopCutBracket(
	eventId: number,
	game: Game | null | undefined,
	config: TopCutModeConfig,
): Promise<ScreenOutputTopCutResponse> {
	return topCutBracketSource(game, config) === 'manual'
		? await findManualBracket(eventId, config.manualBracket, config)
		: await findPhaseBracket(eventId, config.phaseId, config);
}
