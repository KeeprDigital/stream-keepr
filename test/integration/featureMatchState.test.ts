import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { commandId, createCommandHarness } from './featureMatchSessionHelpers';
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
			player1: expect.objectContaining({
				lifeTotal: expect.any(Number),
				gameWins: 0,
			}),
			player2: expect.objectContaining({
				lifeTotal: expect.any(Number),
				gameWins: 0,
			}),
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
