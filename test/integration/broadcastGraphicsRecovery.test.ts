import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createGraphicsHarness,
	getBroadcastGraphicsLiveSession,
	integrationBroadcastGraphic,
	integrationBroadcastGraphicWithInputs,
	integrationTextInput,
	playoutCommandId,
	sendBroadcastGraphicsCommand,
	setBroadcastGraphicInput,
	setScreenMode,
} from './broadcastGraphicsPlayoutHelpers';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';
import { executeIntegrationD1 } from './integrationD1';

/**
 * Recovery and multi-operator hardening, proven through the authoritative surface.
 *
 * Every case here is one a show actually hits: an operator flips the Screen's mode,
 * a second operator edits the same field, someone resets live state to clear a mess.
 * Each is asserted as command in → snapshot out, because that is the only surface
 * two operators and every output share.
 */
/**
 * Damage one Live Session's durable state the way only something outside the command
 * path can.
 *
 * `playout` is written as a JSON array where the shape requires an object, which is
 * the shape a different build or a partial write leaves behind. It is done in SQL
 * precisely because no API can produce it: the point of a recovery fault is that the
 * product itself never writes one.
 */
async function corruptLiveState(sessionId: number): Promise<void> {
	await executeIntegrationD1(
		`UPDATE broadcast_graphics_live_sessions SET current_state = '{"playout":[],"inputs":{}}' WHERE id = ${sessionId};`,
	);
}

async function resetLiveState(eventId: number, screenId: number): Promise<BroadcastGraphicsLiveSessionResponse> {
	return await $fetch<BroadcastGraphicsLiveSessionResponse>(
		`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-session/reset`,
		{ method: 'POST' },
	);
}

describe('broadcast graphics recovery and multi-operator hardening', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Broadcast Graphics Hardening', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	describe('what a mode change keeps and what it discards', () => {
		it('turns every graphic off and advances the epoch, while prepared working values survive', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-mode-change', [
				integrationBroadcastGraphicWithInputs('a', [
					integrationTextInput('name'),
				]),
			]);
			const endedSessionId = harness.session().id;

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			await harness.send({
				commandId: playoutCommandId('take'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});

			await setScreenMode(eventId, harness.screen.id, 'background');
			await setScreenMode(eventId, harness.screen.id, 'broadcast-graphics');

			const next = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);

			expect(next.id).not.toBe(endedSessionId);
			// Nothing on air: an on-air intent from an ended show must never survive into
			// a later one, which is the whole point of the epoch.
			expect(next.currentState.playout).toEqual({});
			// The operator's prepared value does survive: it is not an intent to show
			// anything, it is the work they did to be ready, and a mode change is
			// incidental to the show rather than an instruction to discard it.
			expect(next.currentState.inputs.a?.working).toEqual({ name: 'Ava Reed' });
		});
	});

	describe('an explicit live-state reset', () => {
		it('turns every graphic off, advances the epoch, and discards prepared values', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-reset', [
				integrationBroadcastGraphicWithInputs('a', [
					integrationTextInput('name'),
				]),
			]);
			const endedSessionId = harness.session().id;

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			await harness.send({
				commandId: playoutCommandId('take'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});

			const reset = await resetLiveState(eventId, harness.screen.id);

			expect(reset.id).not.toBe(endedSessionId);
			expect(reset.status).toBe('active');
			expect(reset.currentState).toEqual({ playout: {}, inputs: {}, sources: {} });
		});

		it('leaves the Screen with exactly one epoch, so the next command has one to name', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-reset-usable', [
				integrationBroadcastGraphic('a'),
			]);

			const reset = await resetLiveState(eventId, harness.screen.id);
			const loaded = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
			expect(loaded.id).toBe(reset.id);

			const taken = await sendBroadcastGraphicsCommand(eventId, harness.screen.id, reset.id, {
				commandId: playoutCommandId('post-reset-take'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});
			expect(taken.currentState.playout.a).toMatchObject({ onAir: true });
		});

		it('rejects a command from the epoch it replaced', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-reset-stale', [
				integrationBroadcastGraphic('a'),
			]);
			const endedSessionId = harness.session().id;
			await harness.send({
				commandId: playoutCommandId('take'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});

			const reset = await resetLiveState(eventId, harness.screen.id);

			// Addressed to the ended epoch while the Screen is still a Broadcast Graphics
			// Screen, so the mode guard cannot be what refuses it: the only thing left is
			// the epoch having ended. The message is what discriminates — a neutered epoch
			// guard would still produce a 409 from the compare-and-swap.
			const rejected = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${endedSessionId}/commands`,
				{
					method: 'POST',
					body: {
						commandId: playoutCommandId('reset-stale'),
						type: 'Take',
						payload: { graphicId: 'a' },
					},
					ignoreResponseError: true,
				},
			);

			expect(rejected.status).toBe(409);
			expect(rejected._data?.message).toMatch(/live session has ended/i);

			const after = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
			expect(after.id).toBe(reset.id);
			expect(after.currentState.playout).toEqual({});
		});

		it('refuses to reset a Screen that is not in Broadcast Graphics mode', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-reset-wrong-mode', [
				integrationBroadcastGraphic('a'),
			]);
			await setScreenMode(eventId, harness.screen.id, 'background');

			const res = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-session/reset`,
				{ method: 'POST', ignoreResponseError: true },
			);

			expect(res.status).toBe(409);
		});
	});

	describe('two operators on one Broadcast Graphic', () => {
		it('rejects a stale edit to the same Graphic Input rather than overwriting it', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-same-field', [
				integrationBroadcastGraphicWithInputs('a', [
					integrationTextInput('name'),
				]),
			]);

			await harness.send({
				commandId: playoutCommandId('set-first'),
				type: 'Set Input',
				payload: {
					graphicId: 'a',
					inputKey: 'name',
					value: 'Ava Reed',
					basedOn: { value: '' },
				},
			} as never);

			// The second operator's Live Control still showed the default when they typed.
			const rejected = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
				{
					method: 'POST',
					body: {
						commandId: playoutCommandId('set-second'),
						type: 'Set Input',
						payload: {
							graphicId: 'a',
							inputKey: 'name',
							value: 'Ben Cole',
							basedOn: { value: '' },
						},
					},
					ignoreResponseError: true,
				},
			);

			expect(rejected.status).toBe(409);
			expect(rejected._data?.data?.code).toBe('stale-input-edit');
			expect(rejected._data?.data?.inputKeys).toEqual(['name']);

			// Refused, not applied: the first operator's value is what the show still has.
			const after = await harness.reload();
			expect(after.currentState.inputs.a?.working).toEqual({ name: 'Ava Reed' });
		});
	});

	describe('what every reader is told about the state it loads', () => {
		it('reports no recovery fault for a Live Session written by the command path', async () => {
			// The complement of the recovery unit tests: nothing the product itself writes
			// can produce a fault, so a fault always means the durable state was damaged
			// from outside the command path rather than by ordinary operation.
			const harness = await createGraphicsHarness(eventId, 'hardening-no-fault', [
				integrationBroadcastGraphicWithInputs('a', [
					integrationTextInput('name'),
				]),
			]);

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			const taken = await harness.send({
				commandId: playoutCommandId('take'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});

			expect(taken.session.recoveryFault).toBeNull();
			expect((await harness.reload()).recoveryFault).toBeNull();
		});

		it('clears that fault on the first accepted command, whatever kind it is', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-corrupt-cleared', [
				integrationBroadcastGraphicWithInputs('a', [
					integrationTextInput('name'),
				]),
			]);

			await corruptLiveState(harness.session().id);
			expect((await harness.reload()).recoveryFault).not.toBeNull();

			// A Set Input, deliberately: not a playout action and not a Take. Every command
			// reduces from the recovered state and writes that reduction back, so whichever
			// one is accepted first replaces the state nobody could read. An operator who
			// types before they take is not left staring at a fault that has already gone.
			const edited = await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');

			expect(edited.session.recoveryFault).toBeNull();
			expect((await harness.reload()).recoveryFault).toBeNull();
			expect(edited.currentState.inputs.a!.working).toEqual({ name: 'Ava Reed' });
		});

		it('answers a reloading client with the same authoritative state, however many times it asks', async () => {
			// A reconnecting Live Control or Screen Output reloads rather than replaying,
			// so reloading has to be free of side effects on the show.
			const harness = await createGraphicsHarness(eventId, 'hardening-reload-idempotent', [
				integrationBroadcastGraphic('a'),
			]);
			const taken = await harness.send({
				commandId: playoutCommandId('take'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});

			const reloads = await Promise.all(
				Array.from({ length: 4 }, () => getBroadcastGraphicsLiveSession(eventId, harness.screen.id)),
			);

			for (const reload of reloads) {
				expect(reload.id).toBe(taken.sessionId);
				expect(reload.sequence).toBe(taken.sequence);
				// Compared against the command's own answer rather than against a literal:
				// reloading must return the *same* record, including the authoritative
				// animation start time, which a literal could only restate approximately.
				expect(reload.currentState.playout.a).toEqual(taken.currentState.playout.a);
			}
		});
	});
});
