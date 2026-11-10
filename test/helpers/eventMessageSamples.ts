import type { MessagePayload, MessageType } from '~~/shared/types/messages';

/** The ids one set of sample Event messages names. */
export interface EventMessageSampleIds {
	screenId: number;
	playerId: number;
	/** The other Player a sample Match seats. */
	opponentId: number;
	phaseId: number;
	roundId: number;
	matchId: number;
	slotId: number;
	playerListId: number;
	talentId: number;
	archetypeId: number;
	broadcastDeckListId: number;
}

/** A payload holding only what a message's readers identify it by. */
type Sample<T> = T extends Date
	? T
	: T extends readonly (infer Item)[]
		? Sample<Item>[]
		: T extends object
			? { [K in keyof T]?: Sample<T[K]> }
			: T;

/**
 * One payload for every Event message type, each naming `ids` wherever its
 * type carries one. Keyed by the whole message type union, so a new message
 * type fails to compile here until it has a sample.
 */
export function eventMessageSamples(ids: EventMessageSampleIds): { [K in MessageType]: MessagePayload<K> } {
	const player = {
		id: ids.playerId,
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
	};
	const talent = { id: ids.talentId };
	const phase = { id: ids.phaseId };
	const round = { id: ids.roundId, phaseId: ids.phaseId };
	const match = {
		id: ids.matchId,
		roundId: ids.roundId,
		player1Id: ids.playerId,
		player2Id: ids.opponentId,
	};
	const featureMatch = {
		id: ids.slotId,
		matchId: ids.matchId,
		player1Id: ids.playerId,
		player2Id: ids.opponentId,
	};
	const playerList = { id: ids.playerListId };
	const archetype = { id: ids.archetypeId };

	const samples: { [K in MessageType]: Sample<MessagePayload<K>> } = {
		'event:updated': {
			event: { id: 1 },
		},
		'event:deleted': { eventId: 1 },
		'theme:updated': { theme: {} },
		'talent:created': { talent },
		'talent:updated': { talent },
		'talent:deleted': { talentId: ids.talentId },
		'player:created': { player },
		'player:updated': { player },
		'player:deleted': { playerId: ids.playerId },
		'playerDeck:reviewed': {
			deck: { playerId: ids.playerId },
		},
		'playerDeck:cardsResolved': {
			deckIds: [],
			playerIds: [ids.playerId],
		},
		'phase:created': { phase },
		'phase:updated': { phase },
		'phase:deleted': { phaseId: ids.phaseId },
		'round:created': { round },
		'round:updated': { round },
		'round:deleted': { roundId: ids.roundId },
		'round:matchesRefreshed': {
			roundId: ids.roundId,
			matchCount: 1,
			created: 0,
			updated: 1,
			staleDeleted: 0,
		},
		'match:created': { match },
		'match:updated': { match },
		'match:deleted': { matchId: ids.matchId },
		'featureMatch:created': { featureMatch },
		'featureMatch:updated': { featureMatch },
		'featureMatch:deleted': { featureMatchId: ids.slotId },
		'featureMatch:reordered': {
			featureMatches: [
				{ featureMatchId: ids.slotId, sortOrder: 0 },
			],
		},
		'featureMatchAssignment:created': {
			featureMatchAssignment: { id: 1 },
		},
		'featureMatchAssignment:updated': {
			featureMatchAssignment: { id: 1 },
		},
		'featureMatchAssignment:deleted': { featureMatchAssignmentId: 1 },
		// Seated on the opposite sides from `featureMatch`, as `SwapPlayers` leaves them.
		'featureMatchSession:eventApplied': {
			slotId: ids.slotId,
			sourceSnapshot: {
				player1: { playerId: ids.opponentId },
				player2: { playerId: ids.playerId },
			},
		},
		'broadcastGraphicsLiveSession:commandApplied': { screenId: ids.screenId },
		'broadcastGraphicsLiveSession:epochEnded': { screenId: ids.screenId },
		'playerList:created': { playerList },
		'playerList:updated': { playerList },
		'playerList:deleted': { listId: ids.playerListId },
		'playerList:membersChanged': {
			listId: ids.playerListId,
			playerIds: [ids.playerId],
			action: 'added',
			memberCount: 1,
		},
		'broadcastDeckList:created': { listId: ids.broadcastDeckListId, revision: 1 },
		'broadcastDeckList:updated': { listId: ids.broadcastDeckListId, revision: 2 },
		'broadcastDeckList:deleted': { listId: ids.broadcastDeckListId },
		'archetype:created': { archetype },
		'archetype:updated': { archetype },
		'archetype:deleted': { archetypeId: ids.archetypeId },
		'archetype:keyCardsUpdated': { archetypeId: ids.archetypeId, keyCards: [] },
		'melee:dataReset': { reason: 'disabled' },
		'melee:structureSynced': {
			phaseCount: 1,
			roundCount: 1,
			changes: {
				phases: {
					created: [],
					updated: [ids.phaseId],
					deleted: [],
				},
				rounds: {
					created: [],
					updated: [ids.roundId],
					deleted: [],
				},
			},
		},
		'melee:playersSynced': { playerCount: 1 },
		'melee:featureMatchesSynced': {
			slotIds: [ids.slotId],
		},
		'melee:decklistsSynced': { playerCount: 1, deckCount: 1 },
		'melee:matchResultsSynced': {
			roundId: ids.roundId,
			matchIds: [ids.matchId],
		},
		'melee:pairingsSynced': { roundId: ids.roundId },
		'melee:roundStandingsSynced': { roundId: ids.roundId },
		'tcgplus:imported': { playerCount: 1, deckCount: 1 },
		'card:updated': { card: null, screenId: ids.screenId, revision: 1 },
		'card:preview': { card: {}, screenId: ids.screenId },
		'card:cleared': { screenId: ids.screenId, revision: 2 },
		'screen:created': { screenId: ids.screenId },
		'screen:updated': { screenId: ids.screenId },
		'screen:deleted': { screenId: ids.screenId },
		'screen:command:refresh': { screenId: ids.screenId },
		'screen:command:identify': { screenId: ids.screenId },
		'screen:command:debug': { screenId: ids.screenId },
		'output:eventContextChanged': {},
		'output:modeDataChanged': {
			screenId: ids.screenId,
			causes: ['player'],
		},
	};
	return samples as unknown as { [K in MessageType]: MessagePayload<K> };
}
