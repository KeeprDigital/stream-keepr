import type {
	FeatureMatchResponse,
	MatchResponse,
	PhaseResponse,
	PlayerResponse,
	RoundResponse,
	ScreenResponse,
	TalentResponse,
} from '../api';
import type { BroadcastGraphicsCommandAppliedPayload } from './broadcastGraphicsLiveSession';
import type { MtgCard } from './card/mtg';
import type { FeatureMatchOrientation, Game, ScreenCommand } from './enums';
import type { FeatureMatchSessionEventAppliedPayload } from './featureMatchSession';
import type { CardResponse, PlayerDeckSummaryResponse } from './metagame';

/*
 * Shared message payload types — lightweight API-facing interfaces
 * so that shared/ does not depend on server DB types or app types.
 */

export interface EventPayload {
	id: number;
	name: string;
	game: Game;
	featureMatchOrientation: FeatureMatchOrientation;
}

export interface PlayerListPayload {
	id: number;
	eventId: number;
	name: string;
	memberCount?: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface ArchetypePayload {
	id: number;
	eventId: number;
	name: string;
	colors: string | null;
	keyCards: CardResponse[];
	createdAt: Date;
	updatedAt: Date;
}

export interface ArchetypeCardPayload extends CardResponse {
	archetypeId: number;
	sortOrder: number;
}

export interface BaseMessage {
	eventId: number;
	timestamp: number;
	originConnectionId?: string;
}

export interface MessageDefinitions {
	'event:updated': {
		event: Partial<EventPayload> & Pick<EventPayload, 'id'>;
	};

	'event:deleted': {
		eventId: number;
	};

	// Talent management
	'talent:created': {
		talent: TalentResponse;
	};

	'talent:updated': {
		talent: TalentResponse;
	};

	'talent:deleted': {
		talentId: number;
	};

	// Player management
	'player:created': {
		player: PlayerResponse;
	};

	'player:updated': {
		player: PlayerResponse;
	};

	'player:deleted': {
		playerId: number;
	};

	'playerDeck:reviewed': {
		deck: PlayerDeckSummaryResponse;
	};

	// Phase management
	'phase:created': {
		phase: PhaseResponse;
	};

	'phase:updated': {
		phase: PhaseResponse;
	};

	'phase:deleted': {
		phaseId: number;
	};

	// Round management
	'round:created': {
		round: RoundResponse;
	};

	'round:updated': {
		round: RoundResponse;
	};

	'round:deleted': {
		roundId: number;
	};

	'round:matchesRefreshed': {
		roundId: number;
		matchCount: number;
		created: number;
		updated: number;
		staleDeleted: number;
	};

	// Match management
	'match:created': {
		match: MatchResponse;
	};

	'match:updated': {
		match: MatchResponse;
	};

	'match:deleted': {
		matchId: number;
	};

	// Feature match management
	'featureMatch:created': {
		featureMatch: FeatureMatchResponse;
	};

	'featureMatch:updated': {
		featureMatch: FeatureMatchResponse;
	};

	'featureMatch:deleted': {
		featureMatchId: number;
	};

	'featureMatch:reordered': {
		featureMatches: { featureMatchId: number; sortOrder: number }[];
	};

	'featureMatchSession:eventApplied': FeatureMatchSessionEventAppliedPayload;

	/**
	 * A Broadcast Graphics playout action was accepted. A notification, never
	 * authority: a client that has fallen behind the authoritative sequence
	 * reloads the snapshot instead of trusting this payload.
	 */
	'broadcastGraphicsLiveSession:commandApplied': BroadcastGraphicsCommandAppliedPayload;

	// Player list management
	'playerList:created': {
		playerList: PlayerListPayload;
	};

	'playerList:updated': {
		playerList: PlayerListPayload;
	};

	'playerList:deleted': {
		listId: number;
	};

	'playerList:membersChanged': {
		listId: number;
		playerIds: number[];
		action: 'added' | 'removed' | 'reordered';
		memberCount: number;
	};

	// Archetype management
	'archetype:created': {
		archetype: ArchetypePayload;
	};

	'archetype:updated': {
		archetype: ArchetypePayload;
	};

	'archetype:deleted': {
		archetypeId: number;
	};

	'archetype:keyCardsUpdated': {
		archetypeId: number;
		keyCards: ArchetypeCardPayload[];
	};

	// Melee sync
	'melee:dataReset': {
		reason: 'disabled' | 'event-changed';
	};

	'melee:structureSynced': {
		phaseCount: number;
		roundCount: number;
		changes: {
			phases: {
				created: number[];
				updated: number[];
				deleted: number[];
			};
			rounds: {
				created: number[];
				updated: number[];
				deleted: number[];
			};
		};
	};

	'melee:playersSynced': {
		playerCount: number;
	};

	'melee:featureMatchesSynced': {
		slotIds: number[];
	};

	'melee:decklistsSynced': {
		playerCount: number;
		deckCount: number;
	};

	'melee:roundSynced': {
		roundId: number;
		matchCount: number;
		created: number;
		updated: number;
		staleDeleted: number;
	};

	// Card management (screen-scoped)
	'card:updated': {
		card: MtgCard | null;
		screenId: number;
	};

	'card:preview': {
		card: MtgCard;
		screenId: number;
	};

	'card:cleared': {
		screenId: number;
	};

	'card:timeout': {
		timeoutDuration: number;
		expiresAt: number;
		screenId: number;
	};

	'card:timeout:cancel': {
		screenId: number;
	};

	// Screen management
	'screen:created': {
		screen: ScreenResponse;
	};

	'screen:updated': {
		screen: ScreenResponse;
	};

	'screen:deleted': {
		screenId: number;
	};

	// Screen client commands
	'screen:command:refresh': {
		screenId: number;
	};

	'screen:command:identify': {
		screenId: number;
	};

	'screen:command:debug': {
		screenId: number;
	};

}

// Extract message types from the definitions
export type MessageType = keyof MessageDefinitions;

export const screenCommandMessageTypes = {
	refresh: 'screen:command:refresh',
	identify: 'screen:command:identify',
	debug: 'screen:command:debug',
} as const satisfies Record<ScreenCommand, MessageType>;

export const directChannelMessageTypes = new Set<MessageType>(
	Object.values(screenCommandMessageTypes),
);

// Extract payload types for each message type
export type MessagePayload<T extends MessageType> = MessageDefinitions[T];

// Complete message type (base + payload)
export type CompleteMessage<T extends MessageType> = BaseMessage & (MessagePayload<T> extends undefined ? Record<string, never> : MessagePayload<T>);

// Helper to create a typed message
export function createMessage<T extends MessageType>(
	eventId: number,
	type: T,
	payload?: MessagePayload<T>,
	originConnectionId?: string,
): CompleteMessage<T> {
	return {
		eventId,
		timestamp: Date.now(),
		originConnectionId,
		...(payload || {}),
	} as CompleteMessage<T>;
}
