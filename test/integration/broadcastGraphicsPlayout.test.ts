import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createPlayoutHarness,
	getBroadcastGraphicsSession,
	playoutCommandId,
	sendBroadcastGraphicsCommand,
	setScreenMode,
} from './broadcastGraphicsPlayoutHelpers';
import { $fetchRaw } from './helpers';

/**
 * Broadcast Graphics playout, proven through the authoritative surface: one
 * command in, the authoritative snapshot and its receipt out.
 */
describe('broadcast graphics playout command API', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Broadcast Graphics Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('opens a Broadcast Graphics Live Session with every placed graphic off', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-open', ['a', 'b']);
		const session = harness.session();

		expect(session.status).toBe('active');
		expect(session.screenId).toBe(harness.screen.id);
		expect(session.sequence).toBe(1);
		expect(session.currentState.playout).toEqual({});
	});

	it('takes a Broadcast Graphic on air and outs it again', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-take-out', ['a', 'b']);

		const taken = await harness.send({
			commandId: playoutCommandId('take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		expect(taken.currentState.playout.a).toEqual({ onAir: true });
		expect(taken.sequence).toBe(2);

		const outed = await harness.send({
			commandId: playoutCommandId('out'),
			type: 'Out',
			payload: { graphicId: 'a' },
		});
		expect(outed.currentState.playout.a).toEqual({ onAir: false });
		expect(outed.sequence).toBe(3);
	});

	it('survives reload by answering a fresh snapshot request with the same authoritative state', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-durable', ['a']);
		const taken = await harness.send({
			commandId: playoutCommandId('durable-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});

		const reloaded = await harness.reload();

		expect(reloaded.id).toBe(taken.sessionId);
		expect(reloaded.sequence).toBe(taken.sequence);
		expect(reloaded.currentState.playout.a).toEqual({ onAir: true });
	});

	it('suppresses a duplicate delivery of the same command instead of applying it twice', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-duplicate', ['a']);
		const command = {
			commandId: playoutCommandId('duplicate-take'),
			type: 'Take' as const,
			payload: { graphicId: 'a' },
		};

		const first = await harness.send(command);
		const replay = await sendBroadcastGraphicsCommand(eventId, harness.screen.id, harness.session().id, command);

		expect(replay.sequence).toBe(first.sequence);
		expect(replay.currentState.playout.a).toEqual({ onAir: true });
	});

	it('rejects a command id reused for different content', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-reused-id', ['a', 'b']);
		const reusedId = playoutCommandId('reused');

		await harness.send({ commandId: reusedId, type: 'Take', payload: { graphicId: 'a' } });

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: { commandId: reusedId, type: 'Take', payload: { graphicId: 'b' } },
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(409);
	});

	it('converges on the latest intent when Take is repeated as a distinct command', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-idempotent', ['a']);

		const first = await harness.send({
			commandId: playoutCommandId('idempotent-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		const second = await harness.send({
			commandId: playoutCommandId('idempotent-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});

		expect(second.sequence).toBe(first.sequence + 1);
		expect(second.currentState).toEqual(first.currentState);
	});

	it('reaches the same target state for a Cut action while animation does not exist', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-cut', ['a']);

		const cutTake = await harness.send({
			commandId: playoutCommandId('cut-take'),
			type: 'Take',
			payload: { graphicId: 'a', cut: true },
		});
		expect(cutTake.currentState.playout.a).toEqual({ onAir: true });

		const cutOut = await harness.send({
			commandId: playoutCommandId('cut-out'),
			type: 'Out',
			payload: { graphicId: 'a', cut: true },
		});
		expect(cutOut.currentState.playout.a).toEqual({ onAir: false });
	});

	it('keeps concurrent Broadcast Graphics on air independently', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-concurrent', ['back', 'front']);

		await harness.send({ commandId: playoutCommandId('take-front'), type: 'Take', payload: { graphicId: 'front' } });
		const result = await harness.send({ commandId: playoutCommandId('take-back'), type: 'Take', payload: { graphicId: 'back' } });

		expect(result.currentState.playout).toEqual({
			front: { onAir: true },
			back: { onAir: true },
		});
	});

	it('rejects a playout action for a Broadcast Graphic the Screen does not place', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-unknown', ['a']);

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: { commandId: playoutCommandId('unknown'), type: 'Take', payload: { graphicId: 'nope' } },
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(404);
	});

	it('ends the Live Session when the Screen leaves Broadcast Graphics mode and rejects its stale commands', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-epoch', ['a']);
		const endedSessionId = harness.session().id;
		await harness.send({ commandId: playoutCommandId('epoch-take'), type: 'Take', payload: { graphicId: 'a' } });

		await setScreenMode(eventId, harness.screen.id, 'idle');

		const rejected = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/sessions/${endedSessionId}/commands`,
			{
				method: 'POST',
				body: { commandId: playoutCommandId('epoch-stale'), type: 'Out', payload: { graphicId: 'a' } },
				ignoreResponseError: true,
			},
		);
		expect(rejected.status).toBe(409);

		await setScreenMode(eventId, harness.screen.id, 'broadcast-graphics');
		const nextEpoch = await getBroadcastGraphicsSession(eventId, harness.screen.id);

		expect(nextEpoch.id).not.toBe(endedSessionId);
		expect(nextEpoch.currentState.playout).toEqual({});
	});

	it('refuses a snapshot for a Screen that is not in Broadcast Graphics mode', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-wrong-mode', ['a']);
		await setScreenMode(eventId, harness.screen.id, 'idle');

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/session`,
			{ ignoreResponseError: true },
		);

		expect(res.status).toBe(409);
	});
});
