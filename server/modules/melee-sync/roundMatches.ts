import type { DbPhase, DbPlayer, DbRound } from '~~/server/db/schema';
import type { MatchSideRecord } from '~~/server/mappers/melee';
import {
	externalIdentityKey,
	InvalidMeleeRoundSnapshotError,
	mapMeleeMatchesToDbRows,
	meleeMatchResultState,
} from '~~/server/mappers/melee';
import { archetypeService } from '~~/server/services/archetype';
import { matchService } from '~~/server/services/match';
import { requireMeleeService } from '~~/server/services/meleeIntegration';
import { meleeRoundSnapshotService } from '~~/server/services/meleeRoundSnapshot';
import { MeleeTransportError } from '~~/server/services/meleeTransport';
import { phaseService } from '~~/server/services/phase';
import { playerService } from '~~/server/services/player';
import { playerDeckService } from '~~/server/services/playerDeck';
import { playerRoundStandingsService } from '~~/server/services/playerRoundStandings';
import { roundService } from '~~/server/services/round';
import { isRoundComplete } from '~~/shared/utils/roundCompletion';
import { isMeleeManagedRound } from '~~/shared/utils/roundControl';

export interface SyncMatchesResult {
	success: boolean;
	message: string;
	round: {
		id: number;
		name: string;
		roundNumber: number;
		phaseId: number;
	};
	matchCount: number;
	created: number;
	updated: number;
	staleDeleted: number;
	warnings: string[];
	/** Every Match has a result, or the next Round is paired; only then are Round Standings stored. */
	complete: boolean;
	/** Stored Matches whose Match Result changed. */
	resultChangedMatchIds: number[];
	/** A Match was added, removed, or re-seated, or a side's Player record changed. */
	pairingsChanged: boolean;
	/** The Round's stored Round Standings were replaced with a different set. */
	standingsChanged: boolean;
}

/** What storing the previous Round's Round Standings changed in that Round. */
export interface PreviousRoundStandingsResult
	extends Pick<SyncMatchesResult, 'resultChangedMatchIds' | 'pairingsChanged' | 'standingsChanged'> {
	roundId: number;
}

export interface RoundSnapshotWriteOptions {
	/** Runs just before the snapshot write; throwing abandons it. */
	beforeWrite?: () => Promise<void>;
}

/** Minimal Event shape needed by Melee Sync. */
export interface SyncableEvent {
	meleeEnabled: boolean | null;
	meleeEventId: string | null;
	meleeClientId: string | null;
	meleeClientSecret: string | null;
}

/**
 * An automatic sync reached a Melee Round that exists structurally but has not
 * been paired yet. This is a normal retryable state, not an empty authoritative
 * snapshot.
 */
export class MeleeRoundNotReadyError extends Error {
	readonly code = 'MELEE_ROUND_NOT_READY';
	readonly statusCode = 409;
	readonly statusMessage = 'Melee round not ready';

	constructor(round: Pick<DbRound, 'id' | 'name'>) {
		super(`${round.name} has not been paired in Melee.gg yet`);
		this.name = 'MeleeRoundNotReadyError';
	}
}

/** The Melee-managed Rounds either side of `roundId`, in the Event's Round order. */
async function adjacentMeleeRounds(eventId: number, roundId: number) {
	const meleeRounds = (await roundService().findByEventId(eventId)).filter(round => isMeleeManagedRound(round));
	const index = meleeRounds.findIndex(round => round.id === roundId);
	return {
		previous: index > 0
			? meleeRounds[index - 1]!
			: null,
		next: index >= 0
			? meleeRounds[index + 1] ?? null
			: null,
	};
}

/** Whether the next Melee-managed Round holds pairings: at least one Match stored from Melee. */
async function nextRoundHasPairings(eventId: number, roundId: number): Promise<boolean> {
	const { next } = await adjacentMeleeRounds(eventId, roundId);
	if (!next)
		return false;
	const stored = await matchService().findByRoundId(eventId, next.id);
	return stored.some(match => match.externalSource === 'melee');
}

/**
 * Deep Round Match sync operation.
 *
 * Owns Melee fetching, Match upsert, stale Match deletion, Round Standings
 * snapshots, and marking the Round synced. Round Standings are fetched and
 * stored only for a complete Round; an incomplete Round's stored standings are
 * left alone. Callers should handle request-level success/failure recording
 * and realtime publication around this interface.
 */
export async function syncMatchesFromMelee(
	eventId: number,
	eventData: SyncableEvent,
	round: DbRound,
	phase: DbPhase | null,
	options: RoundSnapshotWriteOptions = {},
): Promise<SyncMatchesResult> {
	return await syncRoundSnapshot(eventId, eventData, round, phase, { ...options, knownComplete: false });
}

/**
 * Fetch and store one Round's Round Standings, treating the Round as complete.
 * Its Matches are re-synced in the same snapshot write, so their Player records
 * carry the standings too.
 */
export async function syncRoundStandingsFromMelee(
	eventId: number,
	eventData: SyncableEvent,
	round: DbRound,
	options: RoundSnapshotWriteOptions = {},
): Promise<SyncMatchesResult> {
	const phase = await phaseService().findById(round.phaseId, eventId);
	return await syncRoundSnapshot(eventId, eventData, round, phase ?? null, { ...options, knownComplete: true });
}

/**
 * Pairing a Round completes the Melee-managed Round before it, so store that
 * Round's Round Standings when it holds none yet. `null` when there is no such
 * Round or it already holds Round Standings. Storing them re-syncs that Round's
 * Matches too, so what changed there is reported alongside.
 */
export async function syncPreviousRoundStandingsFromMelee(
	eventId: number,
	eventData: SyncableEvent,
	round: Pick<DbRound, 'id'>,
	options: RoundSnapshotWriteOptions = {},
): Promise<PreviousRoundStandingsResult | null> {
	const { previous } = await adjacentMeleeRounds(eventId, round.id);
	if (!previous)
		return null;
	const stored = await playerRoundStandingsService().findByRoundId(eventId, previous.id);
	if (stored.length > 0)
		return null;
	const { resultChangedMatchIds, pairingsChanged, standingsChanged } = await syncRoundStandingsFromMelee(eventId, eventData, previous, options);
	return {
		roundId: previous.id,
		resultChangedMatchIds,
		pairingsChanged,
		standingsChanged,
	};
}

/**
 * Each Player's record going into a Round, keyed by Melee TeamId: the previous
 * Melee-managed Round's stored Round Standings. Empty when there is no such
 * Round or it holds none.
 */
async function recordsGoingIntoRound(
	eventId: number,
	roundId: number,
	players: DbPlayer[],
): Promise<Map<number, MatchSideRecord>> {
	const { previous } = await adjacentMeleeRounds(eventId, roundId);
	if (!previous)
		return new Map();
	const stored = await playerRoundStandingsService().findByRoundId(eventId, previous.id);
	const teamIdByPlayerId = new Map(players.flatMap(player =>
		player.externalSource === 'melee' && player.externalId != null
			? [
					[
						player.id,
						Number(player.externalId),
					] as const,
				]
			: []));
	return new Map(stored.flatMap((standing) => {
		const teamId = teamIdByPlayerId.get(standing.playerId);
		return teamId == null
			? []
			: [
					[
						teamId,
						{
							wins: standing.wins,
							losses: standing.losses,
							draws: standing.draws,
							position: standing.position,
							points: standing.points,
						},
					] as const,
				];
	}));
}

async function syncRoundSnapshot(
	eventId: number,
	eventData: SyncableEvent,
	round: DbRound,
	phase: DbPhase | null,
	options: RoundSnapshotWriteOptions & { knownComplete: boolean },
): Promise<SyncMatchesResult> {
	const melee = requireMeleeService(eventData);
	const playerSvc = playerService();

	// Round identity is validated by requireMeleeManagedRound at the write
	// boundary in workflows.ts before this operation runs.
	const meleeRoundId = Number(round.externalId);

	// Melee.gg returns 404 from the round list endpoints when a round has not
	// been paired yet. Only a never-synced round may treat that as "not ready";
	// once a round holds a synced snapshot, a 404 is an upstream anomaly and
	// must not be allowed to read as an empty authoritative refresh.
	const notReadyOn404 = async <T>(fetchItems: Promise<T[]>): Promise<T[]> => {
		try {
			return await fetchItems;
		}
		catch (error) {
			if (
				round.lastSyncedAt == null
				&& error instanceof MeleeTransportError
				&& error.category === 'http'
				&& error.upstreamStatus === 404
			) {
				throw new MeleeRoundNotReadyError(round);
			}
			throw error;
		}
	};

	const [meleeMatches, allPlayers, allDecks, nextPaired] = await Promise.all([
		notReadyOn404(melee.fetchMatchesByRound(meleeRoundId)),
		// Historical rounds may still reference players no longer present in the
		// current Melee snapshot, so retain inactive identities for mapping.
		playerSvc.findAll({ eventId, includeInactive: true }),
		playerDeckService().listByEvent(eventId),
		options.knownComplete || nextRoundHasPairings(eventId, round.id),
	]);
	// A newly paired Round has no standings yet, so readiness is its Matches' alone.
	if (round.lastSyncedAt == null && meleeMatches.length === 0) {
		throw new MeleeRoundNotReadyError(round);
	}
	const complete = isRoundComplete(meleeMatches.map(meleeMatchResultState), nextPaired);
	const standings = complete
		? await melee.fetchStandingsByRound(meleeRoundId)
		: null;

	const playerMap = new Map(
		allPlayers
			?.filter(p => p.externalId !== null && p.externalSource !== null)
			.map(p => [
				externalIdentityKey(p.externalSource!, p.externalId!),
				p,
			]) ?? [],
	);
	const standingTeamIds = new Set<number>();
	for (const standing of standings ?? []) {
		if (standingTeamIds.has(standing.TeamId)) {
			throw new InvalidMeleeRoundSnapshotError(
				`Duplicate Melee Round standing participant ${standing.TeamId}`,
			);
		}
		standingTeamIds.add(standing.TeamId);

		if (!playerMap.has(externalIdentityKey('melee', standing.TeamId))) {
			throw new InvalidMeleeRoundSnapshotError(
				`Round standings reference unknown Melee participant ${standing.TeamId}`,
			);
		}
	}
	const recordsByTeamId = standings
		? new Map(standings.map(standing => [
				standing.TeamId,
				{
					wins: standing.MatchWins,
					losses: standing.MatchLosses,
					draws: standing.MatchDraws,
					position: standing.Rank,
					points: standing.Points,
				},
			]))
		: await recordsGoingIntoRound(eventId, round.id, allPlayers);
	const meleeDecks = allDecks.filter(deck => deck.externalSource === 'melee');
	const playerDecksByPlayerId = new Map<number, typeof meleeDecks>();
	for (const deck of meleeDecks) {
		const playerDecks = playerDecksByPlayerId.get(deck.playerId) ?? [];
		playerDecks.push(deck);
		playerDecksByPlayerId.set(deck.playerId, playerDecks);
	}
	const reviewedArchetypeIds = [
		...new Set(meleeDecks.flatMap(deck =>
			deck.reviewedAt != null && deck.archetypeId != null
				? [deck.archetypeId]
				: [],
		)),
	];
	const reviewedArchetypes = reviewedArchetypeIds.length > 0
		? await archetypeService().findManyByIds(eventId, reviewedArchetypeIds)
		: [];
	const archetypesById = new Map(reviewedArchetypes.map(archetype => [archetype.id, archetype]));
	// Per-match and per-competitor formats are resolved by the mapper before this
	// phase-level fallback. Never let one Match's format leak into another Match.
	const roundFormatExternalId = phase?.formatExternalId ?? null;
	const warnings: string[] = [];

	const matchRows = mapMeleeMatchesToDbRows(meleeMatches, round.id, eventId, {
		playerMap,
		recordsByTeamId,
		playerDecksByPlayerId,
		archetypesById,
		roundFormatExternalId,
		warnings,
	});

	const standingRows = standings?.map((standing) => {
		const player = playerMap.get(externalIdentityKey('melee', standing.TeamId))!;

		return {
			playerId: player.id,
			wins: standing.MatchWins,
			losses: standing.MatchLosses,
			draws: standing.MatchDraws,
			position: standing.Rank,
			points: standing.Points,
		};
	}) ?? null;
	await options.beforeWrite?.();
	const {
		created: matchesCreated,
		updated: matchesUpdated,
		staleDeleted,
		resultChangedMatchIds,
		pairingsChanged,
		standingsChanged,
	} = await meleeRoundSnapshotService().replace({
		eventId,
		roundId: round.id,
		matches: matchRows,
		standings: standingRows,
	});

	const roundName = phase
		? `${phase.name} - ${round.name}`
		: round.name;

	return {
		success: true,
		message: `Synced ${matchRows.length} matches for ${roundName}`,
		round: {
			id: round.id,
			name: round.name,
			roundNumber: round.roundNumber,
			phaseId: round.phaseId,
		},
		matchCount: matchRows.length,
		created: matchesCreated,
		updated: matchesUpdated,
		staleDeleted,
		warnings,
		complete,
		resultChangedMatchIds,
		pairingsChanged,
		standingsChanged,
	};
}
