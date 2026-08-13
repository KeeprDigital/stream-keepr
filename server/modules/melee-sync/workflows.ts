import type { H3Event } from 'h3';
import type { MappedMeleePlayer } from '~~/server/mappers/melee';
import type { MeleeEventParsed, MeleePlayerParsed } from '~~/server/schemas/external/melee';
import type { MeleeSyncMetadataUpdate } from '~~/server/utils/meleeSyncState';
import type { Game } from '~~/shared/types/enums';
import { createError } from 'h3';
import { mapMeleePlayersToDb } from '~~/server/mappers/melee';
import { eventDataPublicationModule, RealtimePublicationError } from '~~/server/modules/event-data-publication';
import { syncMatchesFromMelee } from '~~/server/modules/melee-sync/roundMatches';
import { importedMtgCardResolverService } from '~~/server/services/importedMtgCardResolver';
import { requireMeleeService } from '~~/server/services/meleeIntegration';
import { mtgCardService } from '~~/server/services/mtgCard';
import { phaseService } from '~~/server/services/phase';
import { playerService } from '~~/server/services/player';
import { playerFeatureMatchSyncService } from '~~/server/services/playerFeatureMatchSync';
import { roundService } from '~~/server/services/round';
import { getOriginConnectionId } from '~~/server/utils/ably';
import { publishFailureFields } from '~~/server/utils/realtimePublishFailure';
import { isMeleeManagedRound } from '~~/shared/utils/roundControl';
import {
	buildPlayersWithDeckLists,
	buildResolvedCardUpserts,
	collectImportedDeckCards,
	createImportedCardResolver,
	persistPlayerDeckLists,
} from './deckLists';
import {
	inspectMeleeGameCompatibility,
	unsupportedDeckListAdapterMessage,
} from './gameCompatibility';
import { requireMeleeManagedRound } from './roundValidation';

interface MeleeSyncEventData {
	game: Game;
	meleeEnabled: boolean | null;
	meleeEventId: string | null;
	meleeClientId: string | null;
	meleeClientSecret: string | null;
}

interface DeckListSyncOptions {
	unsupportedGame: 'reject' | 'skip';
}

function inspectSourceGame(eventData: MeleeSyncEventData, meleeEvent: MeleeEventParsed) {
	const compatibility = inspectMeleeGameCompatibility(eventData.game, meleeEvent.Game);
	if (compatibility.status === 'mismatch') {
		throw createError({
			statusCode: 422,
			message: 'The configured Melee.gg tournament uses a different game than this Event',
			data: { code: 'MELEE_GAME_MISMATCH' },
		});
	}
	return compatibility;
}

type RecordMeleeSyncProgress = (metadata: MeleeSyncMetadataUpdate) => void;

interface StructureChangeSet {
	phases: { created: number[]; updated: number[]; deleted: number[] };
	rounds: { created: number[]; updated: number[]; deleted: number[] };
}

function hasStructureChanges(changes: StructureChangeSet) {
	return Object.values(changes.phases).some(ids => ids.length > 0)
		|| Object.values(changes.rounds).some(ids => ids.length > 0);
}

async function publishAfterCommit(
	warnings: string[],
	publish: () => Promise<void>,
): Promise<void> {
	try {
		await publish();
	}
	catch (error) {
		if (!(error instanceof RealtimePublicationError))
			throw error;

		// The provider's account of the refusal, from the `ErrorInfo` the strict
		// publish wrapped. Without it this line says a notification was lost and
		// nothing about why — and under a rejected key it says that once per
		// published stage, forever, with 40400 sitting in the cause each time
		// (#264, the same field set #253 gave the swallowing path).
		console.warn(JSON.stringify({
			message: 'melee_sync_realtime_publish_failed',
			messageType: error.messageType,
			...publishFailureFields(error.cause),
		}));
		warnings.push(`Data was saved, but realtime notification "${error.messageType}" could not be delivered`);
	}
}

/**
 * Creates Phases and Rounds from a Melee Event structure.
 * Rounds are created with status 'upcoming' — Match sync is separate.
 */
function buildPhasesAndRounds(meleeEvent: MeleeEventParsed) {
	const result: Array<{
		phase: { name: string; sortOrder: number; externalId: string; externalSource: 'melee'; formatExternalId: string };
		rounds: Array<{ name: string; roundNumber: number; externalId: string; externalSource: 'melee' }>;
	}> = [];
	const phaseExternalIds = new Set<number>();
	const roundExternalIds = new Set<number>();
	for (const phase of meleeEvent.Phases) {
		if (phaseExternalIds.has(phase.ID))
			throw new Error(`Duplicate Melee phase external identity: ${phase.ID}`);
		phaseExternalIds.add(phase.ID);

		for (const round of phase.Rounds) {
			if (roundExternalIds.has(round.ID))
				throw new Error(`Duplicate Melee round external identity: ${round.ID}`);
			roundExternalIds.add(round.ID);
		}
	}

	const sortedPhases = meleeEvent.Phases.slice().sort((a, b) => a.SortOrder - b.SortOrder);
	for (const phase of sortedPhases) {
		const phaseData = {
			name: phase.Name,
			sortOrder: phase.SortOrder,
			externalId: phase.ID.toString(),
			externalSource: 'melee' as const,
			formatExternalId: phase.FormatId,
		};

		const rounds = phase.Rounds.slice().sort((a, b) => a.SortOrder - b.SortOrder).map((round, roundIndex) => ({
			name: round.Name,
			roundNumber: roundIndex + 1,
			externalId: round.ID.toString(),
			externalSource: 'melee' as const,
		}));

		result.push({ phase: phaseData, rounds });
	}

	return result;
}

export function createMeleeSyncWorkflows() {
	const publication = eventDataPublicationModule();

	async function fetchCoreSnapshot(eventData: MeleeSyncEventData) {
		const melee = requireMeleeService(eventData);
		const [event, players, standings] = await Promise.all([
			melee.fetchEvent(),
			melee.fetchPlayers(),
			melee.fetchCurrentStandings(),
		]);

		const gameCompatibility = inspectSourceGame(eventData, event);

		return {
			event,
			players,
			mappedPlayers: mapMeleePlayersToDb(players, standings),
			gameCompatibility,
		};
	}

	async function syncEventStructure(
		requestEvent: H3Event,
		eventId: number,
		eventData: MeleeSyncEventData,
		meleeEventSnapshot?: MeleeEventParsed,
	) {
		const melee = requireMeleeService(eventData);
		const originConnectionId = getOriginConnectionId(requestEvent);

		const rawMeleeEvent = meleeEventSnapshot ?? await melee.fetchEvent();
		const gameCompatibility = inspectSourceGame(eventData, rawMeleeEvent);
		const structure = buildPhasesAndRounds(rawMeleeEvent);

		const phaseSvc = phaseService();
		const roundSvc = roundService();

		// Reconcile Melee-managed structure by external ID. Local/manual structure is preserved,
		// and stale records are removed only after all upstream records have been upserted.
		const existingPhases = await phaseSvc.findByEventId(eventId);
		const existingRounds = await roundSvc.findByEventId(eventId);
		const existingPhaseByExternalId = new Map(existingPhases.flatMap(phase =>
			phase.externalSource === 'melee' && phase.externalId ? [[phase.externalId, phase] as const] : [],
		));
		const existingRoundByExternalId = new Map(existingRounds.flatMap(round =>
			round.externalSource === 'melee' && round.externalId ? [[round.externalId, round] as const] : [],
		));
		const incomingPhaseExternalIds = new Set<string>();
		const incomingRoundExternalIds = new Set<string>();
		const changes: StructureChangeSet = {
			phases: { created: [], updated: [], deleted: [] },
			rounds: { created: [], updated: [], deleted: [] },
		};
		const warnings: string[] = gameCompatibility.status === 'unknown'
			? ['Melee.gg reported an unrecognized game; generic Event structure was synced but submitted data will be skipped']
			: [];

		let totalPhases = 0;
		let totalRounds = 0;

		for (const { phase: phaseData, rounds: roundsData } of structure) {
			incomingPhaseExternalIds.add(phaseData.externalId);
			const existingPhase = existingPhaseByExternalId.get(phaseData.externalId);
			const phaseUnchanged = existingPhase
				&& existingPhase.name === phaseData.name
				&& existingPhase.sortOrder === phaseData.sortOrder
				&& existingPhase.formatExternalId === phaseData.formatExternalId;
			let phase = existingPhase;
			if (!phaseUnchanged) {
				const upserted = await phaseSvc.upsertByExternalId({
					eventId,
					...phaseData,
				});
				phase = upserted.phase;
				changes.phases[upserted.created ? 'created' : 'updated'].push(phase.id);
			}

			if (!phase) {
				throw new Error(`Failed to reconcile Melee phase ${phaseData.externalId}`);
			}

			totalPhases++;

			for (const roundData of roundsData) {
				incomingRoundExternalIds.add(roundData.externalId);
				const existingRound = existingRoundByExternalId.get(roundData.externalId);
				const roundUnchanged = existingRound
					&& existingRound.name === roundData.name
					&& existingRound.roundNumber === roundData.roundNumber
					&& existingRound.phaseId === phase.id;
				if (!roundUnchanged) {
					const { round, created } = await roundSvc.upsertByExternalId({
						eventId,
						phaseId: phase.id,
						...roundData,
					});
					changes.rounds[created ? 'created' : 'updated'].push(round.id);
				}

				totalRounds++;
			}
		}

		const staleRounds = existingRounds.filter(round =>
			round.externalSource === 'melee'
			&& (!round.externalId || !incomingRoundExternalIds.has(round.externalId)),
		);
		for (const staleRound of staleRounds) {
			if (await roundSvc.remove(staleRound.id, eventId))
				changes.rounds.deleted.push(staleRound.id);
		}

		const stalePhases = existingPhases.filter(phase =>
			phase.externalSource === 'melee'
			&& (!phase.externalId || !incomingPhaseExternalIds.has(phase.externalId)),
		);
		for (const stalePhase of stalePhases) {
			if (await phaseSvc.remove(stalePhase.id, eventId))
				changes.phases.deleted.push(stalePhase.id);
		}

		if (hasStructureChanges(changes)) {
			await publishAfterCommit(warnings, async () => await publication.meleeStructureSynced({
				eventId,
				originConnectionId,
				phaseCount: totalPhases,
				roundCount: totalRounds,
				changes,
			}));
		}

		return {
			success: true,
			message: 'Synced event structure from Melee.gg',
			event: {
				name: rawMeleeEvent.Name,
				game: rawMeleeEvent.Game,
			},
			phases: totalPhases,
			rounds: totalRounds,
			...(warnings.length > 0 ? { warnings } : {}),
		};
	}

	async function syncPlayers(
		requestEvent: H3Event,
		eventId: number,
		eventData: MeleeSyncEventData,
		playersSnapshot?: MappedMeleePlayer[],
	) {
		const melee = requireMeleeService(eventData);
		const originConnectionId = getOriginConnectionId(requestEvent);
		const warnings: string[] = [];

		let mergedPlayers = playersSnapshot;
		if (!mergedPlayers) {
			const [meleeEvent, fetchedPlayers] = await Promise.all([
				melee.fetchEvent(),
				melee.fetchMergedPlayers(),
			]);
			const gameCompatibility = inspectSourceGame(eventData, meleeEvent);
			if (gameCompatibility.status === 'unknown') {
				warnings.push('Melee.gg reported an unrecognized game; generic Players were synced but submitted data will be skipped');
			}
			mergedPlayers = fetchedPlayers;
		}
		const playerSvc = playerService();

		const playerSnapshot = mergedPlayers.map((player) => {
			const { deckLists: _, externalSource: __, ...playerData } = player;
			return playerData;
		});

		const {
			players: upsertedPlayers,
			created,
			updated,
			deactivated,
		} = await playerSvc.reconcileMeleeSnapshot(eventId, playerSnapshot, new Date());
		const playerIds = upsertedPlayers.map(player => player.id);
		// The Player reconcile above has committed, so the reverse sync is a
		// follow-on: a lost Session race must not fail a bulk write that landed.
		const updatedMatchIds = await playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(eventId, playerIds);

		if (updatedMatchIds.length > 0) {
			await publishAfterCommit(warnings, async () => await publication.meleeFeatureMatchesSynced({
				eventId,
				originConnectionId,
				slotIds: updatedMatchIds,
			}));
		}
		await publishAfterCommit(warnings, async () => await publication.meleePlayersSynced({
			eventId,
			originConnectionId,
			playerCount: upsertedPlayers.length,
		}));

		return {
			success: true,
			message: `Synced ${mergedPlayers.length} active players from melee.gg${deactivated > 0 ? `; deactivated ${deactivated} missing player${deactivated === 1 ? '' : 's'}` : ''}`,
			results: { created, updated, deactivated, matchesUpdated: updatedMatchIds.length, errors: [] },
			...(warnings.length > 0 ? { warnings } : {}),
		};
	}

	async function syncRoundMatches(requestEvent: H3Event, eventId: number, eventData: MeleeSyncEventData, roundId: number) {
		const originConnectionId = getOriginConnectionId(requestEvent);
		const publicationWarnings: string[] = [];
		// Re-check at the write boundary even though route-facing Round commands
		// preflight before refreshing Players.
		const round = await requireMeleeManagedRound(eventId, roundId);

		const phase = await phaseService().findById(round.phaseId, eventId);

		const result = await syncMatchesFromMelee(eventId, eventData, round, phase ?? null);
		await publishAfterCommit(publicationWarnings, async () => await publication.meleeRoundSynced({
			eventId,
			originConnectionId,
			roundId,
			matchCount: result.matchCount,
			created: result.created,
			updated: result.updated,
			staleDeleted: result.staleDeleted,
		}));
		return {
			...result,
			warnings: [...(result.warnings ?? []), ...publicationWarnings],
		};
	}

	async function runInitialSetup(
		requestEvent: H3Event,
		eventId: number,
		eventData: MeleeSyncEventData,
		checkpoint?: () => Promise<void>,
		recordProgress?: RecordMeleeSyncProgress,
	) {
		const snapshot = await fetchCoreSnapshot(eventData);
		await checkpoint?.();
		const structureResult = await syncEventStructure(requestEvent, eventId, eventData, snapshot.event);
		recordProgress?.({ lastEventSyncedAt: new Date() });
		await checkpoint?.();
		const playersResult = await syncPlayers(requestEvent, eventId, eventData, snapshot.mappedPlayers);
		recordProgress?.({ lastPlayersSyncedAt: new Date() });
		await checkpoint?.();
		const deckListsResult = await syncDeckLists(
			requestEvent,
			eventId,
			eventData,
			snapshot.players,
			snapshot.event,
			{ unsupportedGame: 'skip' },
		);
		if (deckListsResult.success !== false && !deckListsResult.skipped)
			recordProgress?.({ lastDecklistsSyncedAt: new Date() });
		const success = structureResult.success !== false
			&& playersResult.success !== false
			&& deckListsResult.success !== false;

		return {
			success,
			message: success
				? 'Initial Melee.gg setup completed'
				: 'Initial Melee.gg setup completed with deck list warnings',
			steps: ['structure', 'players', 'decklists'],
			event: structureResult.event,
			phases: structureResult.phases,
			rounds: structureResult.rounds,
			players: playersResult.results,
			deckLists: deckListsResult.results,
			deckListsSkipped: deckListsResult.skipped,
			warnings: [
				...(structureResult.warnings ?? []),
				...(playersResult.warnings ?? []),
				...deckListsResult.warnings,
			],
		};
	}

	async function updateFromMelee(
		requestEvent: H3Event,
		eventId: number,
		eventData: MeleeSyncEventData & { lastDecklistsSyncedAt?: Date | null },
		options: { includeDeckLists?: boolean; advanceRound?: boolean } = {},
		checkpoint?: () => Promise<void>,
		recordProgress?: RecordMeleeSyncProgress,
	) {
		const includeDeckLists = options.includeDeckLists === true || !eventData.lastDecklistsSyncedAt;
		const advanceRound = options.advanceRound !== false;
		const steps: string[] = [];
		const snapshot = await fetchCoreSnapshot(eventData);
		await checkpoint?.();

		const structureResult = await syncEventStructure(requestEvent, eventId, eventData, snapshot.event);
		steps.push('structure');
		recordProgress?.({ lastEventSyncedAt: new Date() });
		await checkpoint?.();

		const playersResult = await syncPlayers(requestEvent, eventId, eventData, snapshot.mappedPlayers);
		steps.push('players');
		recordProgress?.({ lastPlayersSyncedAt: new Date() });
		await checkpoint?.();

		let deckListsResult: Awaited<ReturnType<typeof syncDeckLists>> | null = null;
		if (includeDeckLists) {
			deckListsResult = await syncDeckLists(
				requestEvent,
				eventId,
				eventData,
				snapshot.players,
				snapshot.event,
				{ unsupportedGame: 'skip' },
			);
			steps.push('decklists');
			if (deckListsResult.success !== false && !deckListsResult.skipped)
				recordProgress?.({ lastDecklistsSyncedAt: new Date() });
			await checkpoint?.();
		}

		const roundSvc = roundService();
		const allRounds = await roundSvc.findByEventId(eventId);
		const eligibleRounds = allRounds.filter(round => isMeleeManagedRound(round));
		const nextRound = eligibleRounds.find(round => round.lastSyncedAt === null) ?? null;
		const roundResults: Array<Awaited<ReturnType<typeof syncRoundMatches>> & { role: 'previous' | 'next' | 'latest' }> = [];

		if (advanceRound && nextRound) {
			const nextRoundIndex = eligibleRounds.findIndex(round => round.id === nextRound.id);
			const previousRound = nextRoundIndex > 0 ? eligibleRounds[nextRoundIndex - 1] : null;
			if (previousRound?.lastSyncedAt) {
				roundResults.push({ ...await syncRoundMatches(requestEvent, eventId, eventData, previousRound.id), role: 'previous' });
				steps.push('previous-round');
				await checkpoint?.();
			}
			roundResults.push({ ...await syncRoundMatches(requestEvent, eventId, eventData, nextRound.id), role: 'next' });
			steps.push('next-round');
		}
		else {
			const latestSyncedRound = eligibleRounds.filter(round => round.lastSyncedAt !== null).at(-1) ?? null;
			if (latestSyncedRound) {
				roundResults.push({ ...await syncRoundMatches(requestEvent, eventId, eventData, latestSyncedRound.id), role: 'latest' });
				steps.push('latest-round');
			}
		}

		const success = deckListsResult?.success !== false;
		const warnings = [
			...(structureResult.warnings ?? []),
			...(playersResult.warnings ?? []),
			...(deckListsResult?.warnings ?? []),
			...roundResults.flatMap(result => result.warnings ?? []),
		];
		return {
			success,
			message: success ? 'Updated event data from Melee.gg' : 'Updated event data with deck list warnings',
			warnings,
			steps,
			players: playersResult.results,
			deckLists: deckListsResult?.results ?? null,
			deckListsSkipped: deckListsResult?.skipped ?? false,
			rounds: roundResults,
			advancedRound: roundResults.find(result => result.role === 'next')?.round ?? null,
			refreshedRound: roundResults.find(result => result.role === 'previous' || result.role === 'latest')?.round ?? null,
		};
	}

	async function syncDeckLists(
		requestEvent: H3Event,
		eventId: number,
		eventData: MeleeSyncEventData,
		playersSnapshot?: MeleePlayerParsed[],
		meleeEventSnapshot?: MeleeEventParsed,
		options: DeckListSyncOptions = { unsupportedGame: 'reject' },
	) {
		const originConnectionId = getOriginConnectionId(requestEvent);
		const melee = requireMeleeService(eventData);
		const rawMeleeEvent = meleeEventSnapshot ?? await melee.fetchEvent();
		const gameCompatibility = inspectSourceGame(eventData, rawMeleeEvent);
		const unsupportedMessage = gameCompatibility.status === 'unknown' || eventData.game !== 'mtg'
			? unsupportedDeckListAdapterMessage(eventData.game)
			: null;
		if (unsupportedMessage) {
			if (options.unsupportedGame === 'reject') {
				throw createError({
					statusCode: 422,
					message: unsupportedMessage,
					data: { code: 'MELEE_DECKLIST_GAME_UNSUPPORTED' },
				});
			}

			return {
				success: true,
				skipped: true,
				message: unsupportedMessage,
				results: {
					players: 0,
					deckLists: 0,
					uniqueCards: 0,
					updated: 0,
					matchesUpdated: 0,
					skippedPlayers: 0,
					skippedCards: 0,
					unresolvedCards: 0,
				},
				warnings: [unsupportedMessage],
			};
		}

		const mergedPlayers = mapMeleePlayersToDb(playersSnapshot ?? await melee.fetchPlayers(), []);

		const { cards: allCards, totalDeckLists } = collectImportedDeckCards(mergedPlayers);
		const resolver = importedMtgCardResolverService();
		const resolutionResult = await resolver.resolveBatch(eventId, allCards);
		const resolutionMap = resolutionResult.resolutions;
		const warnings: string[] = [];
		const resolveImportedCard = createImportedCardResolver(resolutionMap);
		const cardUpsertMap = buildResolvedCardUpserts(mergedPlayers, resolutionMap);
		const nameToCard = await mtgCardService().batchUpsert([...cardUpsertMap.values()]);
		const playersWithDeckLists = buildPlayersWithDeckLists(eventId, mergedPlayers);

		const playerSvc = playerService();
		const { players: upsertedPlayers, updated } = await playerSvc.batchUpsertByExternalId(
			playersWithDeckLists.map(({ playerData }) => playerData),
		);

		const { skippedPlayers, unresolvedCards } = await persistPlayerDeckLists({
			eventId,
			eventGame: eventData.game,
			playersWithDeckLists,
			upsertedPlayers,
			nameToCard,
			resolveImportedCard,
			warnings,
		});

		if (unresolvedCards > 0) {
			warnings.push(`${unresolvedCards} deck entr${unresolvedCards === 1 ? 'y remains' : 'ies remain'} unresolved and can be fixed from the Sync page`);
		}

		const playerIds = upsertedPlayers.map(p => p.id);
		// The Player and deck writes above have committed, so the reverse sync is a
		// follow-on: a lost Session race must not fail a bulk write that landed.
		const updatedMatchIds = await playerFeatureMatchSyncService().syncMatchesFromPlayersAfterCommit(eventId, playerIds);
		if (updatedMatchIds.length > 0) {
			await publishAfterCommit(warnings, async () => await publication.meleeFeatureMatchesSynced({
				eventId,
				originConnectionId,
				slotIds: updatedMatchIds,
			}));
		}

		await publishAfterCommit(warnings, async () => await publication.meleeDeckListsSynced({
			eventId,
			originConnectionId,
			playerCount: playersWithDeckLists.length,
			deckCount: totalDeckLists,
		}));

		const success = skippedPlayers === 0;

		if (!success) {
			const partialFailure = new Error(`Deck list sync skipped ${skippedPlayers} player${skippedPlayers === 1 ? '' : 's'}`);
			warnings.push(partialFailure.message);
		}

		return {
			success,
			skipped: false,
			message: `Synced ${totalDeckLists} deck lists for ${playersWithDeckLists.length} players`,
			results: {
				players: playersWithDeckLists.length,
				deckLists: totalDeckLists,
				uniqueCards: cardUpsertMap.size,
				updated,
				matchesUpdated: updatedMatchIds.length,
				skippedPlayers,
				skippedCards: unresolvedCards,
				unresolvedCards,
			},
			warnings,
		};
	}

	return {
		syncEventStructure,
		syncPlayers,
		runInitialSetup,
		updateFromMelee,
		syncRoundMatches,
		syncDeckLists,
	};
}
