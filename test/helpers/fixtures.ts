/**
 * Test data factories.
 * Every entity type has a factory that returns a complete, valid object.
 * Use `overrides` to customise individual fields per test.
 *
 * Convention: factory names are `createMock<Entity>`. Return types match
 * the corresponding `Db*` types from server/db/schema.ts.
 */

import type { DbArchetype, DbEvent, DbEventTalent, DbFeatureMatch, DbMatch, DbPhase, DbPlayer, DbPlayerList, DbPlayerListMember, DbPlayerRoundStandings, DbRound, DbScreen } from '~~/server/db/schema';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { ArchetypeDetailResponse, CardResponse } from '~~/shared/types/metagame';

import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';

/** Frontend Archetype type (DB row + keyCards from junction table). */
type UiArchetype = DbArchetype & { keyCards: CardResponse[] };

// ──────────────── Timestamps ────────────────

const DEFAULT_DATE = new Date('2026-01-01T00:00:00.000Z');

function defaultTimestamps(overrides?: { createdAt?: Date; updatedAt?: Date }) {
	return {
		createdAt: overrides?.createdAt ?? DEFAULT_DATE,
		updatedAt: overrides?.updatedAt ?? DEFAULT_DATE,
	};
}

// ──────────────── Event ────────────────

export function createMockEvent(overrides?: Partial<DbEvent>): DbEvent {
	return {
		id: 1,
		name: 'Test Event',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		cardTimeout: 0,
		numFeatureMatches: 1,
		description: null,
		holdingText: null,
		commentator1TalentId: null,
		commentator2TalentId: null,
		meleeEnabled: false,
		pointsSystem: null,
		meleeEventId: null,
		meleeClientId: null,
		meleeClientSecret: null,
		initialSetupCompletedAt: null,
		lastEventSyncedAt: null,
		lastPlayersSyncedAt: null,
		lastDecklistsSyncedAt: null,
		lastSyncError: null,
		meleeSyncLeaseToken: null,
		meleeSyncLeaseCommand: null,
		meleeSyncLeaseExpiresAt: null,

		displayRecordSeparator: '-',
		displayHideZeroDraws: true,
		displayPositionFormat: 'ordinal',
		featureMatchDefaultBestOf: 3,
		featureMatchDefaultStartingLife: 20,
		featureMatchDefaultClockType: 'countdown',
		featureMatchDefaultClockDuration: 50,
		featureMatchDefaultCountUpAfterCountdown: false,
		featureMatchDefaultTurnTrackingEnabled: false,
		featureMatchDefaultActivePlayerTrackingEnabled: false,
		featureMatchDefaultExtraTurnsEnabled: false,
		featureMatchDefaultExtraTurns: 5,
		featureMatchDefaultExtraTurnsLabel: 'Extra Turns',
		featureMatchDefaultMulliganTrackingEnabled: false,
		standingsEnabled: true,
		lgsEnabled: false,
		pronounsEnabled: true,
		tableNumberEnabled: false,
		...defaultTimestamps(overrides),
		...overrides,
	};
}

// ──────────────── Talent ────────────────

export function createMockTalent(overrides?: Partial<DbEventTalent>): DbEventTalent {
	return {
		id: 1,
		eventId: 1,
		name: 'Test Commentator',
		...defaultTimestamps(overrides),
		...overrides,
	};
}

// ──────────────── Player ────────────────

export function createMockPlayer(overrides?: Partial<DbPlayer>): DbPlayer {
	return {
		id: 1,
		eventId: 1,
		name: 'Test Player',
		pronouns: null,
		externalId: null,
		externalSource: null,
		externalStatus: null,
		isActive: true,
		lastSeenAt: null,
		wins: null,
		losses: null,
		draws: null,
		position: null,
		points: null,
		archetypeId: null,
		lgs: null,
		gameData: null,
		...defaultTimestamps(overrides),
		...overrides,
	};
}

// ──────────────── Archetype ────────────────

export function createMockArchetype(overrides?: Partial<DbArchetype>): DbArchetype {
	return {
		id: 1,
		eventId: 1,
		name: 'Azorius Control',
		colors: 'WU',
		...defaultTimestamps(overrides),
		...overrides,
	};
}

/** Frontend Archetype with keyCards (as returned by the list endpoint). */
export function createMockUiArchetype(overrides?: Partial<UiArchetype>): UiArchetype {
	return {
		...createMockArchetype(overrides as Partial<DbArchetype>),
		keyCards: [],
		...overrides,
	} as UiArchetype;
}

export function createMockArchetypeDetailResponse(overrides?: Partial<ArchetypeDetailResponse>): ArchetypeDetailResponse {
	return {
		id: 1,
		name: 'Azorius Control',
		colors: 'WU',
		keyCards: [],
		playerCount: 1,
		metaShare: 25,
		winRate: 66.7,
		avgPosition: 3,
		cardBreakdown: [
			{
				id: 1,
				name: 'Counterspell',
				cardType: 'Instant',
				scryfallId: 'counterspell',
				colors: 'U',
				cmc: 2,
				manaCost: '{U}{U}',
				inclusionRate: 100,
				avgCopies: 4,
				totalCopies: 4,
				mainboardCount: 1,
				sideboardCount: 0,
				mainboardDeckCount: 1,
				sideboardDeckCount: 0,
				deckCount: 1,
			},
		],
		players: [
			{
				id: 1,
				name: 'Test Player',
				deckName: 'Azorius Control',
				position: 1,
				points: 9,
				wins: 3,
				losses: 0,
				draws: 0,
				colors: 'WU',
			},
		],
		...overrides,
	};
}

// ──────────────── Player List ────────────────

export function createMockPlayerList(overrides?: Partial<DbPlayerList>): DbPlayerList {
	return {
		id: 1,
		eventId: 1,
		name: 'Test List',
		...defaultTimestamps(overrides),
		...overrides,
	};
}

export function createMockPlayerListMember(overrides?: Partial<DbPlayerListMember>): DbPlayerListMember {
	return {
		id: 1,
		listId: 1,
		playerId: 1,
		sortOrder: 0,
		...defaultTimestamps(overrides),
		...overrides,
	};
}

// ──────────────── Feature Match ────────────────

export function createMockFeatureMatch(overrides?: Partial<DbFeatureMatch>): DbFeatureMatch {
	return {
		id: 1,
		eventId: 1,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: null,
		roundName: null,
		formatName: null,
		player1Id: null,
		player2Id: null,
		player1Data: null,
		player2Data: null,
		bestOf: 3,
		sortOrder: 0,
		playerDisplayMode: 'score',
		activeSessionId: null,
		...defaultTimestamps(overrides),
		...overrides,
	};
}

// ──────────────── Feature Match State ────────────────

export function createMockFeatureMatchState(overrides?: Partial<FeatureMatchState>): FeatureMatchState {
	return {
		...createInitialFeatureMatchState(),
		...overrides,
	};
}

// ──────────────── Screen ────────────────

export function createMockScreen(overrides?: Partial<DbScreen>): DbScreen {
	return {
		id: 1,
		eventId: 1,
		name: 'Test Screen',
		slug: 'test-screen',
		currentMode: 'idle',
		modeConfigs: null,
		screenConfig: null,
		stateVersion: 0,
		activeCard: null,
		activeCardVersion: 0,
		...defaultTimestamps(overrides),
		...overrides,
		graphicAssetReferenceVersion: overrides?.graphicAssetReferenceVersion ?? null,
	};
}

// ──────────────── Round ────────────────

export function createMockPlayerRoundStandings(overrides?: Partial<DbPlayerRoundStandings>): DbPlayerRoundStandings {
	return {
		id: 1,
		eventId: 1,
		playerId: 1,
		roundId: 1,
		wins: null,
		losses: null,
		draws: null,
		position: null,
		points: null,
		...defaultTimestamps(overrides),
		...overrides,
	};
}

// ──────────────── Phase ────────────────

export function createMockPhase(overrides?: Partial<DbPhase>): DbPhase {
	return {
		id: 1,
		eventId: 1,
		name: 'Swiss',
		sortOrder: 0,
		externalId: null,
		externalSource: null,
		formatExternalId: null,
		...defaultTimestamps(overrides),
		...overrides,
	};
}

export function createMockRound(overrides?: Partial<DbRound>): DbRound {
	return {
		id: 1,
		eventId: 1,
		phaseId: 1,
		externalId: null,
		externalSource: null,
		name: 'Round 1',
		roundNumber: 1,
		controlMode: 'default',
		lastSyncedAt: null,
		...defaultTimestamps(overrides),
		...overrides,
	};
}

// ──────────────── Match ────────────────

export function createMockMatch(overrides?: Partial<DbMatch>): DbMatch {
	return {
		id: 1,
		eventId: 1,
		roundId: 1,
		externalId: null,
		externalSource: null,
		tableNumber: null,
		player1Id: null,
		player2Id: null,
		player1Data: null,
		player2Data: null,
		sortOrder: 0,
		hasResult: false,
		player1GameWins: null,
		player2GameWins: null,
		gameDraws: null,
		isBye: false,
		resultString: null,
		...defaultTimestamps(overrides),
		...overrides,
	} as DbMatch;
}
