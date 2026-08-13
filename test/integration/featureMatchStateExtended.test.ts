import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commandId, createCommandHarness } from './featureMatchSessionHelpers';

describe('feature match session extended behavior', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration FM Session Extended Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('updates player life, counters, mulligan, and swaps players', async () => {
		const harness = await createCommandHarness(eventId);

		let result = await harness.send({
			commandId: commandId('set-life'),
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 10 },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player1.lifeTotal).toBe(10);

		result = await harness.send({
			commandId: commandId('adjust-life'),
			type: 'AdjustLife',
			payload: { player: 'player2', delta: -4 },
		});
		expect(result.currentState.player2.lifeTotal).toBe(16);

		const counters = [{ type: 'poison', value: 3 }, { type: 'energy', value: 5 }];
		result = await harness.send({
			commandId: commandId('set-counters'),
			type: 'SetCounters',
			payload: { player: 'player1', counters },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player1.counters).toEqual(counters);

		result = await harness.send({
			commandId: commandId('set-cards-kept'),
			type: 'SetCardsKept',
			payload: { player: 'player2', cardsKept: 6 },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player2.cardsKept).toBe(6);

		result = await harness.send({
			commandId: commandId('swap-players'),
			type: 'SwapPlayers',
			payload: {},
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player1.lifeTotal).toBe(16);
		expect(result.currentState.player2.lifeTotal).toBe(10);
	});

	it('applies all clock commands', async () => {
		const harness = await createCommandHarness(eventId);

		let result = await harness.send({
			commandId: commandId('clock-start'),
			type: 'StartClock',
			payload: {},
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.clock.isRunning).toBe(true);

		result = await harness.send({
			commandId: commandId('clock-pause'),
			type: 'PauseClock',
			payload: {},
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.clock.isRunning).toBe(false);

		const durationBeforeAdjust = result.currentState.clock.durationMs;
		result = await harness.send({
			commandId: commandId('clock-adjust'),
			type: 'AdjustClock',
			payload: { deltaMs: 60_000 },
		});
		expect(result.currentState.clock.durationMs).toBe(durationBeforeAdjust + 60_000);

		result = await harness.send({
			commandId: commandId('clock-set'),
			type: 'SetClock',
			payload: { targetMs: 120_000 },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.clock.durationMs - result.currentState.clock.elapsedMs).toBe(120_000);

		result = await harness.send({
			commandId: commandId('clock-reset'),
			type: 'ResetClock',
			payload: { durationMs: 3_000_000 },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.clock.durationMs).toBe(3_000_000);
		expect(result.currentState.clock.elapsedMs).toBe(0);

		result = await harness.send({
			commandId: commandId('clock-restart'),
			type: 'RestartClock',
			payload: {},
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.clock.isRunning).toBe(true);
		expect(result.currentState.clock.elapsedMs).toBe(0);
	});

	it('tracks turns and overtime', async () => {
		const harness = await createCommandHarness(eventId);

		let result = await harness.send({
			commandId: commandId('select-first'),
			type: 'SelectFirstPlayer',
			payload: { player: 'player1' },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.activePlayer).toBe('player1');
		expect(result.currentState.turnNumber).toBe(1);

		result = await harness.send({
			commandId: commandId('step-turn-one'),
			type: 'StepTurn',
			payload: { delta: 1 },
		});
		expect(result.currentState.activePlayer).toBe('player2');
		expect(result.currentState.turnNumber).toBe(1);

		result = await harness.send({
			commandId: commandId('step-turn-two'),
			type: 'StepTurn',
			payload: { delta: 1 },
		});
		expect(result.currentState.activePlayer).toBe('player1');
		expect(result.currentState.turnNumber).toBe(2);

		result = await harness.send({
			commandId: commandId('set-active'),
			type: 'SetActivePlayer',
			payload: { player: 'player2' },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.activePlayer).toBe('player2');

		result = await harness.send({
			commandId: commandId('set-turn-number'),
			type: 'SetTurnNumber',
			payload: { turnNumber: 5 },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.turnNumber).toBe(5);

		result = await harness.send({
			commandId: commandId('start-overtime'),
			type: 'StartOvertime',
			payload: { totalTurns: 5 },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.overtime?.turnsRemaining).toBe(5);

		result = await harness.send({
			commandId: commandId('step-overtime-forward'),
			type: 'StepOvertime',
			payload: { delta: 1 },
		});
		expect(result.currentState.overtime?.turnsRemaining).toBe(4);

		result = await harness.send({
			commandId: commandId('step-overtime-back'),
			type: 'StepOvertime',
			payload: { delta: -1 },
		});
		expect(result.currentState.overtime?.turnsRemaining).toBe(5);
	});

	it('records and undoes game wins with explicit reset options', async () => {
		const harness = await createCommandHarness(eventId, { bestOf: 3 });

		let result = await harness.send({
			commandId: commandId('record-win-one'),
			type: 'RecordGameWin',
			payload: { player: 'player1', resetLife: false, resetCounters: false },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player1.gameWins).toBe(1);
		expect(result.currentState.currentGame).toBe(2);

		result = await harness.send({
			commandId: commandId('record-win-two'),
			type: 'RecordGameWin',
			payload: { player: 'player1' },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player1.gameWins).toBe(2);
		expect(result.currentState.isComplete).toBe(true);

		result = await harness.send({
			commandId: commandId('undo-win'),
			type: 'UndoGameWin',
			payload: { player: 'player1' },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player1.gameWins).toBe(1);
		expect(result.currentState.isComplete).toBe(false);
	});

	it('corrects snapshot setup without resetting live state', async () => {
		const harness = await createCommandHarness(eventId, { bestOf: 3 });

		await harness.send({
			commandId: commandId('state-before-snapshot-correction'),
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 9 },
			baseSequence: harness.session().sequence,
		});

		const updatedSlot = await $fetch<{ activeSession: { sequence: number; sourceSnapshot: { bestOf: number }; currentState: { player1: { lifeTotal: number } } } }>(
			`/api/events/${eventId}/feature-match-slots/${harness.slot.id}/setup`,
			{
				method: 'PATCH',
				body: { bestOf: 5 },
			},
		);

		expect(updatedSlot.activeSession.sequence).toBe(harness.session().sequence + 1);
		expect(updatedSlot.activeSession.sourceSnapshot.bestOf).toBe(5);
		expect(updatedSlot.activeSession.currentState.player1.lifeTotal).toBe(9);
	});

	it('keeps swapped players swapped through a later snapshot correction', async () => {
		const harness = await createCommandHarness(eventId, {
			bestOf: 3,
			player1Data: { name: 'Kim' },
			player2Data: { name: 'Lars' },
		});

		const swapped = await harness.send({
			commandId: commandId('swap-before-correction'),
			type: 'SwapPlayers',
			payload: {},
			baseSequence: harness.session().sequence,
		});
		expect(swapped.sourceSnapshot.player1.data!.name).toBe('Lars');
		const swappedLife = swapped.currentState.player1.lifeTotal;

		// A setup edit that leaves the pairing alone corrects the Session's frozen
		// snapshot from the Slot row — which never saw the swap.
		const updatedSlot = await $fetch<{
			activeSession: {
				sourceSnapshot: { bestOf: number; player1: { data: { name: string } }; player2: { data: { name: string } } };
				currentState: { player1: { lifeTotal: number } };
			};
		}>(
			`/api/events/${eventId}/feature-match-slots/${harness.slot.id}/setup`,
			{ method: 'PATCH', body: { bestOf: 5 } },
		);

		expect(updatedSlot.activeSession.sourceSnapshot.bestOf).toBe(5);
		// The overlay reads a name from the snapshot and a life total from the live
		// state. Rebuilding the snapshot in Slot order while the state stays swapped
		// pairs one player's name with the other's life total.
		expect(updatedSlot.activeSession.sourceSnapshot.player1.data.name).toBe('Lars');
		expect(updatedSlot.activeSession.sourceSnapshot.player2.data.name).toBe('Kim');
		expect(updatedSlot.activeSession.currentState.player1.lifeTotal).toBe(swappedLife);
	});

	it('reorders feature match slots', async () => {
		const first = await createCommandHarness(eventId);
		const second = await createCommandHarness(eventId);

		const down = await $fetch<{ slots: { matchId: number; sortOrder: number }[] }>(`/api/events/${eventId}/feature-match-slots/reorder`, {
			method: 'PATCH',
			body: { slotId: first.slot.id, direction: 'down' },
		});
		expect(down.slots).toHaveLength(2);

		const up = await $fetch<{ slots: { matchId: number; sortOrder: number }[] }>(`/api/events/${eventId}/feature-match-slots/reorder`, {
			method: 'PATCH',
			body: { slotId: second.slot.id, direction: 'up' },
		});
		expect(up.slots).toHaveLength(2);
	});
});
