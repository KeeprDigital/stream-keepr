import type { FeatureMatchSessionResponse, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { toFeatureMatchDefaults } from '~~/shared/types/featureMatchDefaults';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';

/**
 * Shared ground for the Feature Match State store suites. The client mock lives in
 * `featureMatchSessionClientMock.ts`, which a `vi.mock` factory loads without a cycle.
 */
export { sessionClient } from './featureMatchSessionClientMock';

export const EVENT_ID = 1;
export const MATCH_ID = 100;
/** What the suites' `useServerTime` stand-in reads as now. */
export const SERVER_NOW = 1_000_000;

export function createSourceSnapshot(slotId = MATCH_ID): FeatureMatchSourceSnapshot {
	return {
		eventId: EVENT_ID,
		slotId,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: null,
		bestOf: 3,
		playerDisplayMode: 'score',
		game: 'mtg',
		defaults: toFeatureMatchDefaults(null),
		player1: { playerId: null, data: null },
		player2: { playerId: null, data: null },
		createdAt: SERVER_NOW,
	};
}

export function createSession(
	state: FeatureMatchState = createMockFeatureMatchState(),
	overrides: Partial<FeatureMatchSessionResponse> = {},
): FeatureMatchSessionResponse {
	const slotId = overrides.slotId ?? MATCH_ID;
	return {
		id: 500,
		eventId: EVENT_ID,
		slotId,
		sourceSnapshot: createSourceSnapshot(slotId),
		currentState: state,
		sequence: 3,
		status: 'active',
		closedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	};
}

/** A command's answer: the state it settled and the Session at its sequence. */
export function commandResult(
	state: FeatureMatchState = createMockFeatureMatchState(),
	session: Partial<FeatureMatchSessionResponse> = {},
) {
	const responseSession = createSession(state, session);
	return {
		featureMatchState: state,
		session: responseSession,
		sequence: responseSession.sequence,
	};
}

/** A stopped countdown clock at zero, with the fields a test names. */
export function clock(overrides: Partial<FeatureMatchState['clock']> = {}): FeatureMatchState['clock'] {
	return {
		type: 'countdown',
		durationMs: 3_000_000,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: false,
		...overrides,
	};
}

/** Hold a Feature Match State for a Slot in the store, as a load would. */
export function seedState(
	store: ReturnType<typeof useFeatureMatchStateStore>,
	overrides?: Partial<FeatureMatchState>,
	matchId = MATCH_ID,
) {
	const state = createMockFeatureMatchState(overrides);
	store.featureMatchStates.set(matchId, state);
	return state;
}
