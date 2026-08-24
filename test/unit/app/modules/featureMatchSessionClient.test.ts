import { beforeEach, describe, expect, it, vi } from 'vitest';

const repository = {
	getSlot: vi.fn(),
	listSlots: vi.fn(),
	createSession: vi.fn(),
	sendCommand: vi.fn(),
};

vi.mock('~/composables/repositories/useFeatureMatchStateRepository', () => ({
	useFeatureMatchStateRepository: () => repository,
}));

const { useFeatureMatchSessionClient } = await import('~/modules/feature-match-session/client');

function createSession(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		slotId: 2,
		sequence: 4,
		currentState: { currentGame: 1 },
		...overrides,
	};
}

function commandResult(session = createSession({ sequence: 5 })) {
	return {
		currentState: session.currentState,
		session,
		sessionId: session.id,
		sequence: session.sequence,
	};
}

describe('feature Match Session client module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const session = createSession();
		repository.getSlot.mockResolvedValue({ id: 2, activeSession: session });
		repository.createSession.mockResolvedValue(session);
		repository.sendCommand.mockResolvedValue(commandResult());
	});

	it('ensures a missing active session through the HTTP adapter', async () => {
		const createdSession = createSession({ id: 8, sequence: 1 });
		repository.getSlot.mockResolvedValueOnce({ id: 2, activeSession: null });
		repository.createSession.mockResolvedValueOnce(createdSession);

		const client = useFeatureMatchSessionClient();
		const result = await client.ensureSession(1, 2);

		expect(repository.getSlot).toHaveBeenCalledWith(1, 2);
		expect(repository.createSession).toHaveBeenCalledWith(1, 2);
		expect(result).toBe(createdSession);
	});

	it('constructs sequenced clock commands through the HTTP adapter', async () => {
		const client = useFeatureMatchSessionClient();
		await client.startClock(1, 2);

		expect(repository.sendCommand).toHaveBeenCalledWith(1, 7, expect.objectContaining({
			type: 'StartClock',
			payload: {},
			baseSequence: 4,
		}));
	});

	it('constructs state update commands in the client seam', async () => {
		const client = useFeatureMatchSessionClient();
		await client.updateState(1, 2, { firstPlayer: 'player1', activePlayer: 'player1', turnNumber: 1 });

		expect(repository.sendCommand).toHaveBeenCalledWith(1, 7, expect.objectContaining({
			type: 'SelectFirstPlayer',
			payload: { player: 'player1' },
			baseSequence: 4,
		}));
	});

	it('sends a multi-field state update as one Batch command in one round trip', async () => {
		const client = useFeatureMatchSessionClient();
		await client.updateState(1, 2, {
			player1: { lifeTotal: 12, counters: [{ type: 'poison', value: 3 }] },
			player2: { lifeTotal: 9, cardsKept: 6, counters: [], sideboardRevealed: true },
			clock: { targetDisplayMs: 30_000 },
			firstPlayer: 'player2',
			activePlayer: 'player1',
			turnNumber: 4,
			overtime: { totalTurns: 3 },
		});

		// The bound the operator control path relies on: session ensure + command,
		// independent of how many fields the save touched.
		expect(repository.getSlot).toHaveBeenCalledTimes(1);
		expect(repository.sendCommand).toHaveBeenCalledTimes(1);

		expect(repository.sendCommand).toHaveBeenCalledWith(1, 7, expect.objectContaining({
			type: 'Batch',
			baseSequence: 4,
			payload: {
				commands: [
					{ type: 'SetLife', payload: { player: 'player1', lifeTotal: 12 } },
					{ type: 'SetCounters', payload: { player: 'player1', counters: [{ type: 'poison', value: 3 }] } },
					{ type: 'SetLife', payload: { player: 'player2', lifeTotal: 9 } },
					{ type: 'SetCounters', payload: { player: 'player2', counters: [] } },
					{ type: 'SetCardsKept', payload: { player: 'player2', cardsKept: 6 } },
					{ type: 'SetSideboardRevealed', payload: { player: 'player2', revealed: true } },
					{ type: 'SetClock', payload: { targetMs: 30_000 } },
					{ type: 'SetFirstPlayer', payload: { player: 'player2' } },
					{ type: 'SetActivePlayer', payload: { player: 'player1' } },
					{ type: 'SetTurnNumber', payload: { turnNumber: 4 } },
					{ type: 'StartOvertime', payload: { totalTurns: 3 } },
				],
			},
		}));
	});

	it('sends a match-level sideboard reveal as one Batch of two per-player commands', async () => {
		const client = useFeatureMatchSessionClient();
		await client.updateState(1, 2, {
			player1: { sideboardRevealed: true },
			player2: { sideboardRevealed: true },
		});

		expect(repository.sendCommand).toHaveBeenCalledTimes(1);
		expect(repository.sendCommand).toHaveBeenCalledWith(1, 7, expect.objectContaining({
			type: 'Batch',
			baseSequence: 4,
			payload: {
				commands: [
					{ type: 'SetSideboardRevealed', payload: { player: 'player1', revealed: true } },
					{ type: 'SetSideboardRevealed', payload: { player: 'player2', revealed: true } },
				],
			},
		}));
	});

	it('sends a lone sideboardRevealed player update as its primitive command', async () => {
		const client = useFeatureMatchSessionClient();
		await client.updatePlayerFeatureMatchState(1, 2, 'player1', { sideboardRevealed: false });

		expect(repository.sendCommand).toHaveBeenCalledTimes(1);
		expect(repository.sendCommand).toHaveBeenCalledWith(1, 7, expect.objectContaining({
			type: 'SetSideboardRevealed',
			payload: { player: 'player1', revealed: false },
			baseSequence: 4,
		}));
	});

	it('sends a single-field state update as its primitive command, not a Batch', async () => {
		const client = useFeatureMatchSessionClient();
		await client.updateState(1, 2, { turnNumber: 4 });

		expect(repository.sendCommand).toHaveBeenCalledTimes(1);
		expect(repository.sendCommand).toHaveBeenCalledWith(1, 7, expect.objectContaining({
			type: 'SetTurnNumber',
			payload: { turnNumber: 4 },
			baseSequence: 4,
		}));
	});

	it('sends nothing for a state update with no batchable fields', async () => {
		const client = useFeatureMatchSessionClient();
		const session = createSession();
		const result = await client.updateState(1, 2, {});

		expect(repository.sendCommand).not.toHaveBeenCalled();
		expect(result.session).toMatchObject({ id: session.id, sequence: session.sequence });
	});

	it('orchestrates bulk clock actions from slot sessions', async () => {
		repository.listSlots.mockResolvedValue([
			{ id: 2, activeSession: createSession() },
			{ id: 3, activeSession: null },
		]);
		repository.sendCommand.mockResolvedValue(commandResult());

		const client = useFeatureMatchSessionClient();
		const result = await client.bulkClockAction(1, 'pause');

		expect(repository.sendCommand).toHaveBeenCalledOnce();
		expect(repository.sendCommand.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
			type: 'PauseClock',
			baseSequence: 4,
		}));
		expect(result.updates).toHaveLength(1);
		expect(result.updates[0]).toMatchObject({ featureMatchId: 2, sessionId: 7, sequence: 5 });
	});
});
