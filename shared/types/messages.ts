import type {
	FeatureMatchResponse,
	MatchResponse,
	PhaseResponse,
	PlayerResponse,
	RoundResponse,
	TalentResponse,
} from '../api';
import type {
	BroadcastGraphicsCommandAppliedPayload,
	BroadcastGraphicsEpochEndedPayload,
} from './broadcastGraphicsLiveSession';
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

/**
 * The most bytes one published realtime message may carry.
 *
 * Ably enforces a maximum size per published message and the figure is a property
 * of the account's package: its published limits table gives **64 KiB** for Free
 * and Standard and 256 KiB for Pro and Enterprise
 * (https://ably.com/docs/pricing/limits).
 *
 * **This deployment's account is on the Free package** — confirmed by its owner on
 * 2026-08-05, recorded here because the repository holds only an API key and cannot
 * observe the package itself. So 64 KiB is this account's actual ceiling and not
 * merely the documented floor, and every bound measured against it is exact.
 *
 * Designing against the larger number would make every bound here true only while
 * the account stays on a paid package, which is not a property any code can check.
 * A message that exceeds this is logged rather than refused: the write it announces
 * has already committed, and realtime delivery is best-effort by design.
 */
export const MAX_REALTIME_MESSAGE_BYTES = 64 * 1024;

/**
 * How many bytes one message costs on the wire, envelope included.
 *
 * Measured rather than estimated, and measured over the *complete* message rather
 * than the payload, because a publisher deciding whether its notification will fit
 * has to account for the same `eventId`, `timestamp`, and origin connection id the
 * transport will send with it.
 */
export function realtimeMessageBytes<T extends MessageType>(
	eventId: number,
	messageType: T,
	payload?: MessagePayload<T>,
	originConnectionId?: string,
): number {
	return new TextEncoder()
		.encode(JSON.stringify(createMessage(eventId, messageType, payload, originConnectionId)))
		.byteLength;
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
	 *
	 * It carries the difference the command made rather than the live state it
	 * produced. Live state changes on every accepted command and grows with the show,
	 * so publishing it made the largest shows the ones whose notifications silently
	 * stopped arriving — and a client reloading on every command instead would put a
	 * snapshot fetch between an operator pressing Take and program showing it. A
	 * difference too large to deliver is dropped, and a peer given none reloads. See
	 * #168.
	 */
	'broadcastGraphicsLiveSession:commandApplied': BroadcastGraphicsCommandAppliedPayload;

	/**
	 * A Screen's Broadcast Graphics playout epoch ended and any successor starts
	 * fresh. Carries no state: everything a client holds belongs to the epoch that
	 * ended, so the only correct response is to reload the authoritative snapshot.
	 */
	'broadcastGraphicsLiveSession:epochEnded': BroadcastGraphicsEpochEndedPayload;

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

	/*
	 * Screen management.
	 *
	 * A Screen change is announced, never shipped. The Screen entity carries
	 * `modeConfigs`, which storage bounds at 512 KiB — several times
	 * `MAX_REALTIME_MESSAGE_BYTES` — so a notification carrying it stopped being
	 * deliverable at exactly the authored sizes that matter, and stopped silently,
	 * because publication logs and swallows. Naming the Screen and letting each
	 * client reload the authoritative Screen from the API takes the size ceiling off
	 * the realtime path entirely, which is the rule the spec already settled:
	 * realtime is notification, snapshots are authority. See #95.
	 */
	'screen:created': {
		screenId: number;
	};

	'screen:updated': {
		screenId: number;
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
