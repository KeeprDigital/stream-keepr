import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import {
	commandId,
	createCommandHarness,
	sendFeatureMatchCommand,
} from './featureMatchSessionHelpers';
import { $fetchRaw } from './helpers';

describe('feature match session command API', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration FeatureMatchSession Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates slots with an active session and initial projection', async () => {
		const harness = await createCommandHarness(eventId, { bestOf: 3 });
		const session = harness.session();

		expect(session.sequence).toBe(1);
		expect(session.currentState).toMatchObject({
			player1: expect.objectContaining({ lifeTotal: expect.any(Number), gameWins: 0 }),
			player2: expect.objectContaining({ lifeTotal: expect.any(Number), gameWins: 0 }),
			clock: expect.objectContaining({ isRunning: false }),
			currentGame: 1,
			isComplete: false,
		});
		expect(session.sourceSnapshot.bestOf).toBe(3);
	});

	it('applies clock, game win, and reset commands inside one session', async () => {
		const harness = await createCommandHarness(eventId, { bestOf: 3 });

		let result = await harness.send({
			commandId: commandId('start-clock'),
			type: 'StartClock',
			payload: {},
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.clock.isRunning).toBe(true);

		result = await harness.send({
			commandId: commandId('pause-clock'),
			type: 'PauseClock',
			payload: {},
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.clock.isRunning).toBe(false);

		result = await harness.send({
			commandId: commandId('game-win'),
			type: 'RecordGameWin',
			payload: { player: 'player1', resetLife: true, resetCounters: true },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.player1.gameWins).toBe(1);
		expect(result.currentState.currentGame).toBe(2);

		result = await harness.send({
			commandId: commandId('game-reset'),
			type: 'ResetState',
			payload: { type: 'game' },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.currentGame).toBe(2);
		expect(result.currentState.player1.gameWins).toBe(1);

		result = await harness.send({
			commandId: commandId('match-reset'),
			type: 'ResetState',
			payload: { type: 'match' },
			baseSequence: harness.session().sequence,
		});
		expect(result.currentState.currentGame).toBe(1);
		expect(result.currentState.player1.gameWins).toBe(0);
	});

	it('applies a Batch of state setters as one command with one sequence increment', async () => {
		const harness = await createCommandHarness(eventId);
		const baseSequence = harness.session().sequence;

		const result = await harness.send({
			commandId: commandId('batch-save'),
			type: 'Batch',
			payload: {
				commands: [
					{ type: 'SetLife', payload: { player: 'player1', lifeTotal: 12 } },
					{ type: 'SetLife', payload: { player: 'player2', lifeTotal: 9 } },
					{ type: 'SetCounters', payload: { player: 'player1', counters: [{ type: 'poison', value: 3 }] } },
					{ type: 'SetCardsKept', payload: { player: 'player2', cardsKept: 6 } },
					{ type: 'SetSideboardRevealed', payload: { player: 'player1', revealed: true } },
					{ type: 'SetClock', payload: { targetMs: 30_000 } },
					{ type: 'SetFirstPlayer', payload: { player: 'player2' } },
					{ type: 'SetActivePlayer', payload: { player: 'player1' } },
					{ type: 'SetTurnNumber', payload: { turnNumber: 4 } },
				],
			},
			baseSequence,
		});

		expect(result.sequence).toBe(baseSequence + 1);
		expect(result.currentState).toMatchObject({
			player1: expect.objectContaining({ lifeTotal: 12, counters: [{ type: 'poison', value: 3 }], sideboardRevealed: true }),
			player2: expect.objectContaining({ lifeTotal: 9, cardsKept: 6 }),
			firstPlayer: 'player2',
			activePlayer: 'player1',
			turnNumber: 4,
		});
		// SetClock targets display time: on the default countdown clock with no
		// elapsed time, 30s remaining lands as durationMs.
		expect(result.currentState.clock.durationMs).toBe(30_000);
		expect(result.currentState.clock.elapsedMs).toBe(0);
	});

	it('refuses a stale Batch whole, leaving no partially-applied field set', async () => {
		const harness = await createCommandHarness(eventId);
		const staleBaseSequence = harness.session().sequence;

		await harness.send({
			commandId: commandId('advance-before-batch'),
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 15 },
			baseSequence: staleBaseSequence,
		});

		const response = await $fetchRaw(
			`/api/events/${eventId}/feature-match-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: commandId('stale-batch'),
					type: 'Batch',
					payload: {
						commands: [
							{ type: 'SetLife', payload: { player: 'player1', lifeTotal: 3 } },
							{ type: 'SetTurnNumber', payload: { turnNumber: 9 } },
						],
					},
					baseSequence: staleBaseSequence,
				},
			},
		);

		expect(response.status).toBe(409);
		const slot = await $fetch<{ activeSession: { sequence: number; currentState: { player1: { lifeTotal: number }; turnNumber: number } } }>(
			`/api/events/${eventId}/feature-match-slots/${harness.slot.id}`,
		);
		expect(slot.activeSession.sequence).toBe(staleBaseSequence + 1);
		expect(slot.activeSession.currentState.player1.lifeTotal).toBe(15);
		expect(slot.activeSession.currentState.turnNumber).toBe(0);
	});

	it('deduplicates commandId by returning the existing projection without appending', async () => {
		const harness = await createCommandHarness(eventId);
		const idempotentCommandId = commandId('idempotent-life');
		const command = {
			commandId: idempotentCommandId,
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 15 },
			baseSequence: harness.session().sequence,
		} satisfies Parameters<typeof harness.send>[0];

		const first = await harness.send(command);
		const second = await sendFeatureMatchCommand(eventId, harness.session().id, command);

		expect(first.sequence).toBe(second.sequence);
		expect(second.currentState.player1.lifeTotal).toBe(15);
	});

	it('answers a retry with the current authoritative snapshot, not the one the command produced', async () => {
		const harness = await createCommandHarness(eventId);
		const retriedCommand = {
			commandId: commandId('retry-after-advance'),
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 15 },
			baseSequence: harness.session().sequence,
		} satisfies Parameters<typeof harness.send>[0];

		const first = await harness.send(retriedCommand);

		// The session moves on before the original command is retried.
		await harness.send({
			commandId: commandId('advance-before-retry'),
			type: 'SetLife',
			payload: { player: 'player2', lifeTotal: 7 },
			baseSequence: harness.session().sequence,
		});

		const retried = await sendFeatureMatchCommand(eventId, harness.session().id, retriedCommand);

		expect(retried.sequence).toBe(first.sequence + 1);
		expect(retried.currentState.player1.lifeTotal).toBe(15);
		expect(retried.currentState.player2.lifeTotal).toBe(7);
	});

	it('rejects reuse of a commandId for a different payload', async () => {
		const harness = await createCommandHarness(eventId);
		const reusedCommandId = commandId('mismatched-idempotency');

		await harness.send({
			commandId: reusedCommandId,
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 15 },
			baseSequence: harness.session().sequence,
		});

		const response = await $fetchRaw(
			`/api/events/${eventId}/feature-match-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: reusedCommandId,
					type: 'SetLife',
					payload: { player: 'player1', lifeTotal: 14 },
					baseSequence: harness.session().sequence,
				},
			},
		);

		expect(response.status).toBe(409);
	});

	it('requires an exact base sequence for non-mergeable commands', async () => {
		const harness = await createCommandHarness(eventId);
		const response = await $fetchRaw(
			`/api/events/${eventId}/feature-match-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: commandId('missing-base-sequence'),
					type: 'SetLife',
					payload: { player: 'player1', lifeTotal: 12 },
				},
			},
		);

		expect(response.status).toBe(400);
	});

	it('commits only one non-mergeable command at a shared sequence', async () => {
		const harness = await createCommandHarness(eventId);
		const baseSequence = harness.session().sequence;
		const path = `/api/events/${eventId}/feature-match-sessions/${harness.session().id}/commands`;
		const responses = await Promise.all([
			$fetchRaw(path, {
				method: 'POST',
				body: {
					commandId: commandId('concurrent-set-life-one'),
					type: 'SetLife',
					payload: { player: 'player1', lifeTotal: 11 },
					baseSequence,
				},
			}),
			$fetchRaw(path, {
				method: 'POST',
				body: {
					commandId: commandId('concurrent-set-life-two'),
					type: 'SetLife',
					payload: { player: 'player1', lifeTotal: 12 },
					baseSequence,
				},
			}),
		]);

		expect(responses.map(response => response.status).toSorted()).toEqual([200, 409]);
		const slot = await $fetch<{ activeSession: { sequence: number } }>(
			`/api/events/${eventId}/feature-match-slots/${harness.slot.id}`,
		);
		expect(slot.activeSession.sequence).toBe(baseSequence + 1);
	});

	it('collapses two simultaneous Session opens onto the one Session the Slot keeps', async () => {
		const harness = await createCommandHarness(eventId);
		const path = `/api/events/${eventId}/feature-match-slots/${harness.slot.id}/sessions`;

		const responses = await Promise.all([
			$fetchRaw(path, { method: 'POST' }),
			$fetchRaw(path, { method: 'POST' }),
		]);

		// Neither operator is refused: an open closes any active Session first, so
		// the loser has nothing to retry — it adopts the winner instead.
		expect(responses.map(response => response.status)).toEqual([200, 200]);

		const slot = await $fetch<{ activeSession: { id: number; status: string } }>(
			`/api/events/${eventId}/feature-match-slots/${harness.slot.id}`,
		);
		// Both callers were handed the Session the Slot actually owns. Answering
		// either of them with the row it inserted strands one on a Session that was
		// closed milliseconds later, and its SessionStarted announces a corpse.
		expect(responses.map(response => response._data.id)).toEqual([slot.activeSession.id, slot.activeSession.id]);
		expect(slot.activeSession.status).toBe('active');
	});

	it('allows mergeable commands after the session has advanced', async () => {
		const harness = await createCommandHarness(eventId);
		const staleBaseSequence = harness.session().sequence;

		await harness.send({
			commandId: commandId('advance-before-mergeable'),
			type: 'SetTurnNumber',
			payload: { turnNumber: 3 },
			baseSequence: staleBaseSequence,
		});

		const result = await harness.send({
			commandId: commandId('mergeable-adjust-life'),
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -3 },
			baseSequence: staleBaseSequence,
		});

		expect(result.currentState.player1.lifeTotal).toBe(17);
		expect(result.sequence).toBe(harness.session().sequence);
	});
});
