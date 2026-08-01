import type { FeatureMatchSessionCommandResult, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';

const mockCreateSessionForSlot = vi.fn();
const mockApplyCommand = vi.fn();
const mockPublishMessage = vi.fn();

const mockRefreshLiveBindings = vi.fn();

vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({
	broadcastGraphicsLiveSessionModule: () => ({ refreshLiveBindings: mockRefreshLiveBindings }),
}));

vi.mock('~~/server/services/featureMatchState', () => ({
	featureMatchStateService: () => ({
		createSessionForSlot: mockCreateSessionForSlot,
		applyCommand: mockApplyCommand,
	}),
}));

vi.mock('~~/server/utils/ably', () => ({
	publishMessage: mockPublishMessage,
}));

const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');

function sourceSnapshot(): FeatureMatchSourceSnapshot {
	return {
		eventId: 1,
		slotId: 2,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: 12,
		bestOf: 3,
		playerDisplayMode: 'score',
		game: 'mtg',
		defaults: DEFAULT_FEATURE_MATCH_DEFAULTS,
		player1: { playerId: null, data: null },
		player2: { playerId: null, data: null },
		createdAt: 1000,
	};
}

describe('feature Match Session server module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a session and publishes the SessionStarted event at the module seam', async () => {
		const currentState = createInitialFeatureMatchState();
		const snapshot = sourceSnapshot();
		mockCreateSessionForSlot.mockResolvedValue({
			id: 10,
			eventId: 1,
			slotId: 2,
			sequence: 1,
			sourceSnapshot: snapshot,
			currentState,
			createdAt: new Date(),
			updatedAt: new Date(),
			closedAt: null,
		});

		const response = await featureMatchSessionModule().createSessionForSlot(2, 1, 'origin-1');

		expect(response).toMatchObject({ id: 10, sequence: 1, sourceSnapshot: snapshot, currentState });
		expect(mockCreateSessionForSlot).toHaveBeenCalledWith(2, 1);
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatchSession:eventApplied', {
			slotId: 2,
			sessionId: 10,
			sequence: 1,
			eventType: 'SessionStarted',
			sourceSnapshot: snapshot,
			currentState,
		}, 'origin-1');
	});

	it('applies a command as a published live-state write at the module seam', async () => {
		const result = {
			slotId: 2,
			sessionId: 10,
			sequence: 2,
			eventType: 'SetLife',
			sourceSnapshot: sourceSnapshot(),
			currentState: createInitialFeatureMatchState(),
			session: {},
		} as FeatureMatchSessionCommandResult;
		const command = {
			commandId: 'command-1',
			type: 'SetLife' as const,
			payload: { player: 'player1' as const, lifeTotal: 18 },
			baseSequence: 1,
		};
		mockApplyCommand.mockResolvedValue(result);

		await expect(featureMatchSessionModule().applyCommand(10, 1, command, 'origin-1')).resolves.toBe(result);

		// Publication is the shared live-state module's post-commit phase; the route
		// seam only asks for it.
		expect(mockApplyCommand).toHaveBeenCalledWith(10, 1, command, 'origin-1', { publish: true });
		expect(mockPublishMessage).not.toHaveBeenCalled();
		// A Graphic Input Binding may read a Feature Match Slot's live state, and this is
		// the one such change that never passes through Event Data publication — so a
		// Broadcast Graphic bound to a life total is caught up from here or not at all.
		expect(mockRefreshLiveBindings).toHaveBeenCalledWith({ eventId: 1, originConnectionId: 'origin-1' });
	});
});
