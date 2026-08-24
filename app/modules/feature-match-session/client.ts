import type { BulkClockAction, PlayerSide, ResetType } from '~~/shared/types/enums';
import type {
	FeatureMatchBatchSubCommand,
	FeatureMatchSessionCommand,
	FeatureMatchSessionCommandResult,
	FeatureMatchSessionResponse,
} from '~~/shared/types/featureMatchSession';
import type {
	FeatureMatchState,
	GameWinOptions,
	PlayerFeatureMatchStateUpdate,
} from '~~/shared/types/featureMatchState';
import { randomCommandId, randomUuid } from '~~/shared/utils/uuid';
import { useFeatureMatchStateRepository } from '~/composables/repositories/useFeatureMatchStateRepository';

export interface FeatureMatchResetOptions {
	type: ResetType;
	startingLife?: number;
}

export interface BulkClockUpdate {
	featureMatchId: number;
	featureMatchState: FeatureMatchState;
	session: FeatureMatchSessionResponse;
	sessionId: number;
	sequence: number;
}

export interface FeatureMatchCommandStateResult {
	featureMatchState: FeatureMatchState;
	session: FeatureMatchSessionResponse;
	sequence: number;
}

/** The per-player fields a state save can set. */
export interface FeatureMatchPlayerStatePatch {
	lifeTotal?: number;
	counters?: FeatureMatchState['player1']['counters'];
	cardsKept?: number;
	sideboardRevealed?: boolean;
}

/**
 * A partial-state save. Only the fields present claim ownership, and every
 * field here maps to a setter command — the type admits nothing the seam
 * would silently drop. The clock field is the reading the operator sees
 * (`SetClock` targets display time), not raw elapsed milliseconds.
 */
export interface FeatureMatchStateUpdate {
	player1?: FeatureMatchPlayerStatePatch;
	player2?: FeatureMatchPlayerStatePatch;
	clock?: { targetDisplayMs: number };
	firstPlayer?: PlayerSide;
	activePlayer?: PlayerSide | null;
	turnNumber?: number;
	overtime?: { totalTurns: number };
}

const PLAYER_SIDES: readonly PlayerSide[] = ['player1', 'player2'];

function toCommandStateResult(result: FeatureMatchSessionCommandResult): FeatureMatchCommandStateResult {
	return {
		featureMatchState: result.currentState,
		session: result.session,
		sequence: result.sequence,
	};
}

function sessionStateResult(session: FeatureMatchSessionResponse): FeatureMatchCommandStateResult {
	return {
		featureMatchState: session.currentState,
		session,
		sequence: session.sequence,
	};
}

/**
 * Decompose a partial-state update into the setter commands that express it.
 * The order mirrors the serial sends this replaced: player fields, clock,
 * first/active player, turn number, overtime — so a batch reduces to exactly
 * the state the serial commands produced.
 */
function buildStateUpdateCommands(update: FeatureMatchStateUpdate): FeatureMatchBatchSubCommand[] {
	const commands: FeatureMatchBatchSubCommand[] = [];

	for (const player of PLAYER_SIDES) {
		const patch = update[player];
		if (!patch)
			continue;
		if (patch.lifeTotal !== undefined)
			commands.push({ type: 'SetLife', payload: { player, lifeTotal: patch.lifeTotal } });
		if (patch.counters !== undefined)
			commands.push({ type: 'SetCounters', payload: { player, counters: patch.counters } });
		if (patch.cardsKept !== undefined)
			commands.push({ type: 'SetCardsKept', payload: { player, cardsKept: patch.cardsKept } });
		if (patch.sideboardRevealed !== undefined)
			commands.push({ type: 'SetSideboardRevealed', payload: { player, revealed: patch.sideboardRevealed } });
	}

	if (update.clock !== undefined)
		commands.push({ type: 'SetClock', payload: { targetMs: update.clock.targetDisplayMs } });

	const { firstPlayer, activePlayer, turnNumber } = update;
	const selectsInitialFirstPlayer = firstPlayer !== undefined && activePlayer === firstPlayer && turnNumber === 1;
	if (firstPlayer) {
		commands.push(selectsInitialFirstPlayer
			? { type: 'SelectFirstPlayer', payload: { player: firstPlayer } }
			: { type: 'SetFirstPlayer', payload: { player: firstPlayer } });
	}
	if (activePlayer !== undefined && !selectsInitialFirstPlayer)
		commands.push({ type: 'SetActivePlayer', payload: { player: activePlayer } });
	if (turnNumber !== undefined && !selectsInitialFirstPlayer)
		commands.push({ type: 'SetTurnNumber', payload: { turnNumber } });
	if (update.overtime !== undefined)
		commands.push({ type: 'StartOvertime', payload: { totalTurns: update.overtime.totalTurns } });

	return commands;
}

function createBulkClockCommand(
	action: BulkClockAction,
	session: FeatureMatchSessionResponse,
	commandId: string,
	deltaMs?: number,
): FeatureMatchSessionCommand | null {
	switch (action) {
		case 'start':
			return { commandId, type: 'StartClock', payload: {}, baseSequence: session.sequence };
		case 'pause':
			return { commandId, type: 'PauseClock', payload: {}, baseSequence: session.sequence };
		case 'reset':
			return { commandId, type: 'ResetClock', payload: {}, baseSequence: session.sequence };
		case 'restart':
			return { commandId, type: 'RestartClock', payload: {}, baseSequence: session.sequence };
		case 'adjust':
			return deltaMs === undefined
				? null
				: { commandId, type: 'AdjustClock', payload: { deltaMs } };
	}
}

/**
 * Client-side Feature Match Session seam.
 *
 * The repository is the HTTP adapter. This Module owns command construction,
 * command sequencing, and bulk command orchestration so stores depend on one
 * deep Interface instead of route payload details.
 */
export function useFeatureMatchSessionClient() {
	const repository = useFeatureMatchStateRepository();

	const ensureSession = async (
		eventId: number,
		slotId: number,
	): Promise<FeatureMatchSessionResponse | null> => {
		const slot = await repository.getSlot(eventId, slotId);
		if (!slot)
			return null;
		return slot.activeSession ?? (await repository.createSession(eventId, slotId));
	};

	const sendSlotCommand = async (
		eventId: number,
		slotId: number,
		createCommand: (session: FeatureMatchSessionResponse) => FeatureMatchSessionCommand,
	): Promise<FeatureMatchCommandStateResult> => {
		const session = await ensureSession(eventId, slotId);
		if (!session)
			throw new Error('Feature match session not found');

		const result = await repository.sendCommand(eventId, session.id, createCommand(session));
		return toCommandStateResult(result);
	};

	const loadState = async (eventId: number, slotId: number): Promise<FeatureMatchState | null> => {
		const session = await ensureSession(eventId, slotId);
		return session?.currentState ?? null;
	};

	/**
	 * One save, one command. The update decomposes into the same setter commands
	 * it always has, but they travel inside a single `Batch` (or alone, when only
	 * one field changed) against one ensured session — so the request count is
	 * bounded regardless of how many fields the operator edited, and the server
	 * applies the whole save atomically or not at all.
	 */
	const updateState = async (
		eventId: number,
		slotId: number,
		update: FeatureMatchStateUpdate,
	): Promise<FeatureMatchCommandStateResult> => {
		const session = await ensureSession(eventId, slotId);
		if (!session)
			throw new Error('Feature match session not found');

		const commands = buildStateUpdateCommands(update);
		if (commands.length === 0)
			return sessionStateResult(session);

		const command: FeatureMatchSessionCommand = commands.length === 1
			? { ...commands[0]!, commandId: randomCommandId(commands[0]!.type), baseSequence: session.sequence }
			: { commandId: randomCommandId('Batch'), type: 'Batch', payload: { commands }, baseSequence: session.sequence };

		return toCommandStateResult(await repository.sendCommand(eventId, session.id, command));
	};

	const startClock = (eventId: number, slotId: number) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('StartClock'),
		type: 'StartClock',
		payload: {},
		baseSequence: session.sequence,
	}));

	const pauseClock = (eventId: number, slotId: number) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('PauseClock'),
		type: 'PauseClock',
		payload: {},
		baseSequence: session.sequence,
	}));

	const resetClock = (eventId: number, slotId: number) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('ResetClock'),
		type: 'ResetClock',
		payload: {},
		baseSequence: session.sequence,
	}));

	const restartClock = (eventId: number, slotId: number) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('RestartClock'),
		type: 'RestartClock',
		payload: {},
		baseSequence: session.sequence,
	}));

	const adjustClock = (eventId: number, slotId: number, deltaMs: number) => sendSlotCommand(eventId, slotId, () => ({
		commandId: randomCommandId('AdjustClock'),
		type: 'AdjustClock',
		payload: { deltaMs },
	}));

	const setClock = (eventId: number, slotId: number, targetMs: number) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('SetClock'),
		type: 'SetClock',
		payload: { targetMs },
		baseSequence: session.sequence,
	}));

	const bulkClockAction = async (
		eventId: number,
		action: BulkClockAction,
		deltaMs?: number,
	): Promise<{ updates: BulkClockUpdate[] }> => {
		const slots = await repository.listSlots(eventId);
		const bulkId = randomUuid();
		const updates: BulkClockUpdate[] = [];

		for (const slot of slots) {
			const session = slot.activeSession;
			if (!session)
				continue;

			const command = createBulkClockCommand(action, session, `bulk:${bulkId}:${session.id}:${action}`, deltaMs);
			if (!command)
				continue;

			const result = await repository.sendCommand(eventId, session.id, command);
			updates.push({
				featureMatchId: slot.id,
				featureMatchState: result.currentState,
				session: result.session,
				sessionId: result.sessionId,
				sequence: result.sequence,
			});
		}

		return { updates };
	};

	const updatePlayerFeatureMatchState = async (
		eventId: number,
		slotId: number,
		player: PlayerSide,
		update: PlayerFeatureMatchStateUpdate,
	): Promise<FeatureMatchCommandStateResult> => {
		let result: FeatureMatchCommandStateResult | null = null;
		if (update.lifeDelta !== undefined) {
			result = await sendSlotCommand(eventId, slotId, () => ({
				commandId: randomCommandId('AdjustLife'),
				type: 'AdjustLife',
				payload: { player, delta: update.lifeDelta! },
			}));
		}
		else if (update.lifeTotal !== undefined) {
			const lifeTotal = update.lifeTotal;
			result = await sendSlotCommand(eventId, slotId, session => ({
				commandId: randomCommandId('SetLife'),
				type: 'SetLife',
				payload: { player, lifeTotal },
				baseSequence: session.sequence,
			}));
		}

		if (update.counters !== undefined) {
			const counters = update.counters;
			result = await sendSlotCommand(eventId, slotId, session => ({
				commandId: randomCommandId('SetCounters'),
				type: 'SetCounters',
				payload: { player, counters },
				baseSequence: session.sequence,
			}));
		}
		if (update.cardsKept !== undefined) {
			const cardsKept = update.cardsKept;
			result = await sendSlotCommand(eventId, slotId, session => ({
				commandId: randomCommandId('SetCardsKept'),
				type: 'SetCardsKept',
				payload: { player, cardsKept },
				baseSequence: session.sequence,
			}));
		}
		if (update.sideboardRevealed !== undefined) {
			const revealed = update.sideboardRevealed;
			result = await sendSlotCommand(eventId, slotId, session => ({
				commandId: randomCommandId('SetSideboardRevealed'),
				type: 'SetSideboardRevealed',
				payload: { player, revealed },
				baseSequence: session.sequence,
			}));
		}

		if (!result)
			throw new Error('No player state update supplied');
		return result;
	};

	const recordGameWin = (eventId: number, slotId: number, player: PlayerSide, options: GameWinOptions = {}) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('RecordGameWin'),
		type: 'RecordGameWin',
		payload: { player, ...options },
		baseSequence: session.sequence,
	}));

	const undoGameWin = (eventId: number, slotId: number, player: PlayerSide, options: GameWinOptions = {}) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('UndoGameWin'),
		type: 'UndoGameWin',
		payload: { player, ...options },
		baseSequence: session.sequence,
	}));

	const resetMatch = (eventId: number, slotId: number, options: FeatureMatchResetOptions) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('ResetState'),
		type: 'ResetState',
		payload: options,
		baseSequence: session.sequence,
	}));

	const swapPlayers = (eventId: number, slotId: number) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('SwapPlayers'),
		type: 'SwapPlayers',
		payload: {},
		baseSequence: session.sequence,
	}));

	const startOvertime = (eventId: number, slotId: number, totalTurns: number) => sendSlotCommand(eventId, slotId, session => ({
		commandId: randomCommandId('StartOvertime'),
		type: 'StartOvertime',
		payload: { totalTurns },
		baseSequence: session.sequence,
	}));

	const stepTurn = (eventId: number, slotId: number, delta: number) => sendSlotCommand(eventId, slotId, () => ({
		commandId: randomCommandId('StepTurn'),
		type: 'StepTurn',
		payload: { delta },
	}));

	const stepOvertime = (eventId: number, slotId: number, delta: number) => sendSlotCommand(eventId, slotId, () => ({
		commandId: randomCommandId('StepOvertime'),
		type: 'StepOvertime',
		payload: { delta },
	}));

	return {
		loadState,
		updateState,
		startClock,
		pauseClock,
		resetClock,
		restartClock,
		adjustClock,
		setClock,
		bulkClockAction,
		updatePlayerFeatureMatchState,
		recordGameWin,
		undoGameWin,
		resetMatch,
		swapPlayers,
		startOvertime,
		stepTurn,
		stepOvertime,
		ensureSession,
	};
}
