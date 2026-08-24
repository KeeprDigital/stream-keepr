/**
 * Test data factories.
 * Every entity type has a factory that returns a complete, valid object.
 * Use `overrides` to customise individual fields per test.
 *
 * Convention: factory names are `createMock<Entity>`. Return types match
 * the corresponding `Db*` types from server/db/schema.ts.
 *
 * That last sentence is the reason for the second convention below. `Db*` is the
 * server's own row shape, with real `Date`s in it — which is what a server-side test
 * reads and is not what a client-side one does. Anything a browser reads has been
 * through `JSON.stringify` on the way out of Nitro and `JSON.parse` on the way in,
 * which leaves an ISO string wherever the type still promises a `Date` (#272, #284).
 *
 * So: `createMock<Entity>` for a server-side row, `createWireMock<Entity>` for the
 * same row as a client sees it. The wire siblings are derived from the `createMock*`
 * factories rather than declared beside them, so there is one place to change when a
 * field is added, and `toWire` is available for fixtures that are not built here.
 * See "Wire shape" at the foot of this file.
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
		twitchHandle: null,
		youtubeHandle: null,
		xHandle: null,
		instagramHandle: null,
		tiktokHandle: null,
		blueskyHandle: null,
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
		currentMode: 'background',
		modeConfigs: null,
		screenConfig: null,
		stateVersion: 0,
		assetCapabilitySeed: 'test-capability-seed',
		assetCapabilityVersion: 1,
		assetCapabilityDigest: 'test-capability-digest',
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

// ──────────────── Wire shape ────────────────

/**
 * The same row, typed as it arrives in a browser.
 *
 * Every `Date` is a string by then and nothing else changes: `JSON.stringify` writes
 * `toJSON()` for a Date and `JSON.parse` has no way to put one back. The types on both
 * sides go on saying `Date`, which is exactly why a fixture that hands a client-side
 * consumer a real one can leave a live defect green — #291's `formatSyncTime` threw on
 * the wire's string while nine tests passed on the fixture's Date.
 */
export type Wire<T> = {
	[K in keyof T]: T[K] extends Date
		? string
		: T[K] extends Date | null
			? string | null
			: T[K] extends Date | null | undefined
				? string | null | undefined
				: T[K];
};

/**
 * Puts any fixture through the round trip Nitro and `$fetch` perform between them.
 *
 * For fixtures built outside this file — a suite's own literal, a store's seeded
 * state — where the shape question is the same one.
 */
export function toWire<T>(row: T): Wire<T> {
	return JSON.parse(JSON.stringify(row)) as Wire<T>;
}

/** Derives a `createWireMock*` sibling from a `createMock*` factory, overrides and all. */
function wireFactory<O, T>(factory: (overrides?: O) => T): (overrides?: O) => Wire<T> {
	return overrides => toWire(factory(overrides));
}

/**
 * The wire siblings, one per factory that carries a timestamp.
 *
 * Overrides are still given in the server's vocabulary — `createWireMockRound({
 * lastSyncedAt: new Date(...) })` — because an override describes the row, and the
 * round trip is what the factory is for. The two factories with no `Date` anywhere
 * (`createMockFeatureMatchState`, `createMockArchetypeDetailResponse`) get no sibling:
 * their output already survives the trip unchanged.
 *
 * Additive on purpose. Nothing that reads `createMock*` today changes shape, and a
 * suite adopts the production shape one call at a time (#296, #284).
 */
export const createWireMockEvent = wireFactory(createMockEvent);
export const createWireMockTalent = wireFactory(createMockTalent);
export const createWireMockPlayer = wireFactory(createMockPlayer);
export const createWireMockArchetype = wireFactory(createMockArchetype);
export const createWireMockUiArchetype = wireFactory(createMockUiArchetype);
export const createWireMockPlayerList = wireFactory(createMockPlayerList);
export const createWireMockPlayerListMember = wireFactory(createMockPlayerListMember);
export const createWireMockFeatureMatch = wireFactory(createMockFeatureMatch);
export const createWireMockScreen = wireFactory(createMockScreen);
export const createWireMockPlayerRoundStandings = wireFactory(createMockPlayerRoundStandings);
export const createWireMockPhase = wireFactory(createMockPhase);
export const createWireMockRound = wireFactory(createMockRound);
export const createWireMockMatch = wireFactory(createMockMatch);
