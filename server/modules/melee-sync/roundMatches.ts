import type { DbPhase, DbRound } from '~~/server/db/schema';
import {
	externalIdentityKey,
	InvalidMeleeRoundSnapshotError,
	mapMeleeMatchesToDbRows,
} from '~~/server/mappers/melee';
import { archetypeService } from '~~/server/services/archetype';
import { requireMeleeService } from '~~/server/services/meleeIntegration';
import { meleeRoundSnapshotService } from '~~/server/services/meleeRoundSnapshot';
import { playerService } from '~~/server/services/player';
import { playerDeckService } from '~~/server/services/playerDeck';

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

/**
 * Deep Round Match sync operation.
 *
 * Owns Melee fetching, Match upsert, stale Match deletion, Round Standings
 * snapshots, and marking the Round synced. Callers should handle request-level
 * success/failure recording and realtime publication around this interface.
 */
export async function syncMatchesFromMelee(
	eventId: number,
	eventData: SyncableEvent,
	round: DbRound,
	phase: DbPhase | null,
): Promise<SyncMatchesResult> {
	const melee = requireMeleeService(eventData);
	const playerSvc = playerService();

	// Round identity is validated by requireMeleeManagedRound at the write
	// boundary in workflows.ts before this operation runs.
	const meleeRoundId = Number(round.externalId);

	const [meleeMatches, standings, allPlayers, allDecks] = await Promise.all([
		melee.fetchMatchesByRound(meleeRoundId),
		melee.fetchStandingsByRound(meleeRoundId),
		// Historical rounds may still reference players no longer present in the
		// current Melee snapshot, so retain inactive identities for mapping.
		playerSvc.findAll({ eventId, includeInactive: true }),
		playerDeckService().listByEvent(eventId),
	]);
	if (round.lastSyncedAt == null && meleeMatches.length === 0 && standings.length === 0) {
		throw new MeleeRoundNotReadyError(round);
	}

	const playerMap = new Map(
		allPlayers
			?.filter(p => p.externalId !== null && p.externalSource !== null)
			.map(p => [externalIdentityKey(p.externalSource!, p.externalId!), p]) ?? [],
	);
	const standingTeamIds = new Set<number>();
	for (const standing of standings) {
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
	const standingsMap = new Map(standings.map(standing => [standing.TeamId, standing]));
	const meleeDecks = allDecks.filter(deck => deck.externalSource === 'melee');
	const playerDecksByPlayerId = new Map<number, typeof meleeDecks>();
	for (const deck of meleeDecks) {
		const playerDecks = playerDecksByPlayerId.get(deck.playerId) ?? [];
		playerDecks.push(deck);
		playerDecksByPlayerId.set(deck.playerId, playerDecks);
	}
	const reviewedArchetypeIds = [...new Set(meleeDecks.flatMap(deck =>
		deck.reviewedAt != null && deck.archetypeId != null ? [deck.archetypeId] : [],
	))];
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
		standingsMap,
		playerDecksByPlayerId,
		archetypesById,
		roundFormatExternalId,
		warnings,
	});

	const standingRows = standings.map((standing) => {
		const player = playerMap.get(externalIdentityKey('melee', standing.TeamId))!;

		return {
			playerId: player.id,
			wins: standing.MatchWins,
			losses: standing.MatchLosses,
			draws: standing.MatchDraws,
			position: standing.Rank,
			points: standing.Points,
		};
	});
	const {
		created: matchesCreated,
		updated: matchesUpdated,
		staleDeleted,
	} = await meleeRoundSnapshotService().replace({
		eventId,
		roundId: round.id,
		matches: matchRows,
		standings: standingRows,
	});

	const roundName = phase ? `${phase.name} - ${round.name}` : round.name;

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
	};
}
