import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import { $fetch } from '@nuxt/test-utils/e2e';
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
import { $fetchRaw } from './helpers';

/**
 * Recovery and multi-operator hardening, proven through the authoritative surface.
 *
 * Every case here is one a show actually hits: an operator flips the Screen's mode,
 * a second operator edits the same field, someone resets live state to clear a mess.
 * Each is asserted as command in → snapshot out, because that is the only surface
 * two operators and every output share.
 */
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
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
			]);
			const endedSessionId = harness.session().id;

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			await harness.send({ commandId: playoutCommandId('take'), type: 'Take', payload: { graphicId: 'a' } });

			await setScreenMode(eventId, harness.screen.id, 'idle');
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

		it('carries no accepted value across the boundary, and the next Take accepts the working one', async () => {
			// Nothing is on air in the new epoch, so there is no rendering for an accepted
			// value to be the last accepted state of — and keeping it would let acceptance's
			// unavailable-value fallback speak for a show that is over. The next Take does
			// not need it: acceptance reads the carried working value.
			const harness = await createGraphicsHarness(eventId, 'hardening-mode-change-accepted', [
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
			]);

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			await harness.send({ commandId: playoutCommandId('take'), type: 'Take', payload: { graphicId: 'a' } });

			await setScreenMode(eventId, harness.screen.id, 'idle');
			await setScreenMode(eventId, harness.screen.id, 'broadcast-graphics');

			const next = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
			expect(next.currentState.inputs.a?.accepted).toEqual({});
			expect(next.currentState.inputs.a?.acceptedRevision).toBe(0);

			const taken = await sendBroadcastGraphicsCommand(eventId, harness.screen.id, next.id, {
				commandId: playoutCommandId('post-mode-change-take'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});
			expect(taken.currentState.inputs.a?.accepted).toEqual({ name: 'Ava Reed' });
		});

		it('blocks a Take a carried-forward acceptance would otherwise have let through', async () => {
			// The reason accepted values do not cross the boundary, asserted end to end: a
			// required Graphic Input whose working value is unavailable must stop the Take,
			// and it would not if the previous epoch's acceptance were still standing in
			// for it.
			const harness = await createGraphicsHarness(eventId, 'hardening-required-across-epoch', [
				integrationBroadcastGraphicWithInputs('a', [
					integrationTextInput('name', { required: true, maxLength: 10 }),
				]),
			]);

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			await harness.send({ commandId: playoutCommandId('take'), type: 'Take', payload: { graphicId: 'a' } });
			// Now unavailable: longer than the declaration allows, so never acceptable.
			await setBroadcastGraphicInput(harness, 'a', 'name', 'A'.repeat(50));

			await setScreenMode(eventId, harness.screen.id, 'idle');
			await setScreenMode(eventId, harness.screen.id, 'broadcast-graphics');
			const next = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);

			const rejected = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${next.id}/commands`,
				{
					method: 'POST',
					body: {
						commandId: playoutCommandId('blocked-take'),
						type: 'Take',
						payload: { graphicId: 'a' },
					},
					ignoreResponseError: true,
				},
			);

			expect(rejected.status).toBe(409);
			expect(rejected._data?.data?.code).toBe('required-input-unavailable');
		});

		it('opens a fresh epoch with nothing at all for a Screen that never had one', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-first-epoch', [
				integrationBroadcastGraphic('a'),
			]);

			expect(harness.session().currentState).toEqual({ playout: {}, inputs: {}, sources: {} });
			expect(harness.session().recoveryFault).toBeNull();
		});
	});

	describe('an explicit live-state reset', () => {
		it('turns every graphic off, advances the epoch, and discards prepared values', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-reset', [
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
			]);
			const endedSessionId = harness.session().id;

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			await harness.send({ commandId: playoutCommandId('take'), type: 'Take', payload: { graphicId: 'a' } });

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
			await harness.send({ commandId: playoutCommandId('take'), type: 'Take', payload: { graphicId: 'a' } });

			const reset = await resetLiveState(eventId, harness.screen.id);

			// Addressed to the ended epoch while the Screen is still a Broadcast Graphics
			// Screen, so the mode guard cannot be what refuses it: the only thing left is
			// the epoch having ended. The message is what discriminates — a neutered epoch
			// guard would still produce a 409 from the compare-and-swap.
			const rejected = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${endedSessionId}/commands`,
				{
					method: 'POST',
					body: { commandId: playoutCommandId('reset-stale'), type: 'Take', payload: { graphicId: 'a' } },
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
			await setScreenMode(eventId, harness.screen.id, 'idle');

			const res = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-session/reset`,
				{ method: 'POST', ignoreResponseError: true },
			);

			expect(res.status).toBe(409);
		});
	});

	describe('two operators on one Broadcast Graphic', () => {
		it('merges edits to different Graphic Inputs', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-disjoint', [
				integrationBroadcastGraphicWithInputs('a', [
					integrationTextInput('name'),
					integrationTextInput('title'),
				]),
			]);

			// Each operator claims the value they were shown for their own field: the
			// declared default, because neither field has been edited yet.
			await harness.send({
				commandId: playoutCommandId('set-name'),
				type: 'Set Input',
				payload: { graphicId: 'a', inputKey: 'name', value: 'Ava Reed', basedOn: { value: '' } },
			} as never);
			const merged = await harness.send({
				commandId: playoutCommandId('set-title'),
				type: 'Set Input',
				payload: { graphicId: 'a', inputKey: 'title', value: 'Champion', basedOn: { value: '' } },
			} as never);

			expect(merged.currentState.inputs.a?.working).toEqual({ name: 'Ava Reed', title: 'Champion' });
		});

		it('rejects a stale edit to the same Graphic Input rather than overwriting it', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-same-field', [
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
			]);

			await harness.send({
				commandId: playoutCommandId('set-first'),
				type: 'Set Input',
				payload: { graphicId: 'a', inputKey: 'name', value: 'Ava Reed', basedOn: { value: '' } },
			} as never);

			// The second operator's Live Control still showed the default when they typed.
			const rejected = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
				{
					method: 'POST',
					body: {
						commandId: playoutCommandId('set-second'),
						type: 'Set Input',
						payload: { graphicId: 'a', inputKey: 'name', value: 'Ben Cole', basedOn: { value: '' } },
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

		it('accepts the same operator’s next edit once they have seen what landed', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-refresh', [
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
			]);
			await harness.send({
				commandId: playoutCommandId('set-first'),
				type: 'Set Input',
				payload: { graphicId: 'a', inputKey: 'name', value: 'Ava Reed', basedOn: { value: '' } },
			} as never);

			// Rejected and refreshed: the refusal is recoverable by looking, which is the
			// difference between a conflict rule and a lock.
			const accepted = await harness.send({
				commandId: playoutCommandId('set-refreshed'),
				type: 'Set Input',
				payload: { graphicId: 'a', inputKey: 'name', value: 'Ben Cole', basedOn: { value: 'Ava Reed' } },
			} as never);

			expect(accepted.currentState.inputs.a?.working).toEqual({ name: 'Ben Cole' });
		});

		it('leaves an edit that claims nothing unguarded, so the guard is a property of the claim', async () => {
			const harness = await createGraphicsHarness(eventId, 'hardening-no-claim', [
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
			]);
			await harness.send({
				commandId: playoutCommandId('set-first'),
				type: 'Set Input',
				payload: { graphicId: 'a', inputKey: 'name', value: 'Ava Reed', basedOn: { value: '' } },
			} as never);

			const overwritten = await setBroadcastGraphicInput(harness, 'a', 'name', 'Ben Cole');

			expect(overwritten.currentState.inputs.a?.working).toEqual({ name: 'Ben Cole' });
		});

		it('still refuses a stale acceptance of the staged set, which is a different mechanism', async () => {
			// The field guard refuses an overtaken *edit*; the acceptance revision refuses
			// an overtaken *acceptance*. Neither substitutes for the other, so both are
			// asserted against the same graphic.
			const harness = await createGraphicsHarness(eventId, 'hardening-stale-acceptance', [
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
			]);
			await harness.send({ commandId: playoutCommandId('take'), type: 'Take', payload: { graphicId: 'a' } });
			const staleRevision = harness.session().currentState.inputs.a!.acceptedRevision;

			await setBroadcastGraphicInput(harness, 'a', 'name', 'Ava Reed');
			await harness.send({
				commandId: playoutCommandId('accept'),
				type: 'Update Graphic',
				payload: { graphicId: 'a', basedOnAcceptedRevision: staleRevision },
			});

			const rejected = await $fetchRaw(
				`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
				{
					method: 'POST',
					body: {
						commandId: playoutCommandId('accept-stale'),
						type: 'Update Graphic',
						payload: { graphicId: 'a', basedOnAcceptedRevision: staleRevision },
					},
					ignoreResponseError: true,
				},
			);

			expect(rejected.status).toBe(409);
			expect(rejected._data?.data?.code).toBe('stale-input-acceptance');
		});
	});

	describe('what every reader is told about the state it loads', () => {
		it('reports no recovery fault for a Live Session written by the command path', async () => {
			// The complement of the recovery unit tests: nothing the product itself writes
			// can produce a fault, so a fault always means the durable state was damaged
			// from outside the command path rather than by ordinary operation.
			const harness = await createGraphicsHarness(eventId, 'hardening-no-fault', [
				integrationBroadcastGraphicWithInputs('a', [integrationTextInput('name')]),
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
