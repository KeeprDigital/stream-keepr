import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createBroadcastGraphicsScreen,
	createGraphicsHarness,
	createPlayoutHarness,
	getBroadcastGraphicsLiveSession,
	integrationBroadcastGraphic,
	integrationBroadcastGraphicWithInputs,
	integrationGraphicAnimation,
	integrationTextInput,
	playoutCommandId,
	sendBroadcastGraphicsCommand,
	setBroadcastGraphicInput,
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
		expect(taken.currentState.playout.a).toMatchObject({ onAir: true, cut: false });
		expect(taken.sequence).toBe(2);

		const outed = await harness.send({
			commandId: playoutCommandId('out'),
			type: 'Out',
			payload: { graphicId: 'a' },
		});
		expect(outed.currentState.playout.a).toMatchObject({ onAir: false, cut: false });
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
		// Byte-for-byte the same record, effective animation start time included.
		// Recovery neither clears nor refreshes it: the whole reason it is safe to
		// persist is that reading it literally already resolves to the Graphic Resting
		// State by the time anyone reads it, so a reload that "helpfully" reset it is
		// precisely what would replay an entrance on program.
		expect(reloaded.currentState.playout.a).toEqual(taken.currentState.playout.a);
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
		// Including the effective animation start time: a retried Take must not restart
		// an entrance that is already running on program.
		expect(replay.currentState.playout.a).toEqual(first.currentState.playout.a);
	});

	it('rejects a command id reused for different content', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-reused-id', ['a', 'b']);
		const reusedId = playoutCommandId('reused');

		await harness.send({ commandId: reusedId, type: 'Take', payload: { graphicId: 'a' } });

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
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

	it('reaches the same target state for a Cut action, and records that it was Cut', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-cut', ['a']);

		const cutTake = await harness.send({
			commandId: playoutCommandId('cut-take'),
			type: 'Take',
			payload: { graphicId: 'a', cut: true },
		});
		expect(cutTake.currentState.playout.a).toMatchObject({ onAir: true, cut: true });

		const cutOut = await harness.send({
			commandId: playoutCommandId('cut-out'),
			type: 'Out',
			payload: { graphicId: 'a', cut: true },
		});
		expect(cutOut.currentState.playout.a).toMatchObject({ onAir: false, cut: true });
	});

	it('keeps concurrent Broadcast Graphics on air independently', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-concurrent', ['back', 'front']);

		await harness.send({ commandId: playoutCommandId('take-front'), type: 'Take', payload: { graphicId: 'front' } });
		const result = await harness.send({ commandId: playoutCommandId('take-back'), type: 'Take', payload: { graphicId: 'back' } });

		expect(result.currentState.playout).toMatchObject({
			front: { onAir: true },
			back: { onAir: true },
		});
	});

	it('records one authoritative effective animation start time, and never a phase', async () => {
		// The command API is where the durable shape becomes observable, so this is
		// where the no-replay invariant is worth stating: what a Take writes down is
		// the operator's intent, the instant it was accepted, and whether it was Cut.
		// Nothing writes down a lifecycle phase, so a restart has no phase to resume.
		const harness = await createPlayoutHarness(eventId, 'playout-start-time', ['a']);
		const before = Date.now();

		const taken = await harness.send({
			commandId: playoutCommandId('start-time-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		const record = taken.currentState.playout.a!;

		expect(Object.keys(record).toSorted()).toEqual(['cut', 'effectiveStartedAt', 'onAir']);
		// The server's own clock, not a client's: every output projects animation from
		// this instant, so it comes from the one place that orders commands.
		expect(record.effectiveStartedAt).toBeGreaterThanOrEqual(before);
		expect(record.effectiveStartedAt).toBeLessThanOrEqual(Date.now());
	});

	it('starts a new effective animation start time when the intent actually changes', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-restart', ['a']);

		const taken = await harness.send({
			commandId: playoutCommandId('restart-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		const outed = await harness.send({
			commandId: playoutCommandId('restart-out'),
			type: 'Out',
			payload: { graphicId: 'a' },
		});

		expect(outed.currentState.playout.a!.effectiveStartedAt)
			.toBeGreaterThanOrEqual(taken.currentState.playout.a!.effectiveStartedAt);
		expect(outed.currentState.playout.a!.onAir).toBe(false);
	});

	it('rejects a playout action for a Broadcast Graphic the Screen does not place', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-unknown', ['a']);

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
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
		await setScreenMode(eventId, harness.screen.id, 'broadcast-graphics');

		const nextEpoch = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
		expect(nextEpoch.id).not.toBe(endedSessionId);
		expect(nextEpoch.currentState.playout).toEqual({});

		// Retried against the ended epoch while the Screen is a Broadcast Graphics
		// Screen again, so the Screen-mode guard cannot be what rejects it: the only
		// thing left to refuse this command is the epoch it names having ended.
		const rejected = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${endedSessionId}/commands`,
			{
				method: 'POST',
				body: { commandId: playoutCommandId('epoch-stale'), type: 'Out', payload: { graphicId: 'a' } },
				ignoreResponseError: true,
			},
		);

		expect(rejected.status).toBe(409);
		expect(rejected._data?.message).toMatch(/live session has ended/i);

		// The stale retry reached neither epoch: the show running now still has
		// nothing on air.
		const afterRetry = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
		expect(afterRetry.id).toBe(nextEpoch.id);
		expect(afterRetry.sequence).toBe(nextEpoch.sequence);
		expect(afterRetry.currentState.playout).toEqual({});
	});

	it('opens exactly one epoch for a Screen no matter how many clients ask at once', async () => {
		// Every Live Control and Screen Output opens the epoch by asking for the
		// snapshot, so a show starting up races several of these at once. Only one
		// epoch may exist per Screen — the partial unique index on the active status
		// is what enforces it, and the loser of the race has to resolve to the
		// winner's epoch rather than failing or creating a second one.
		const screen = await createBroadcastGraphicsScreen(
			eventId,
			'playout-single-epoch',
			[integrationBroadcastGraphic('a')],
		);

		const opened = await Promise.all(
			Array.from({ length: 6 }, () => getBroadcastGraphicsLiveSession(eventId, screen.id)),
		);

		expect(new Set(opened.map(session => session.id)).size).toBe(1);
		expect(opened.every(session => session.status === 'active')).toBe(true);
	});

	it('refuses a snapshot for a Screen that is not in Broadcast Graphics mode', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-wrong-mode', ['a']);
		await setScreenMode(eventId, harness.screen.id, 'idle');

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-session`,
			{ ignoreResponseError: true },
		);

		expect(res.status).toBe(409);
	});
});

/**
 * Live playout animation, proven through the authoritative surface.
 *
 * The schedule an output animates against is decided here, at acceptance, from the
 * Screen's own authored Graphic Animation — so these are the tests that prove the
 * durations actually reach the reducer, rather than an output inventing a schedule
 * of its own.
 */
describe('broadcast graphics live playout animation', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Live Playout Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('stamps effective start times on the clock outputs synchronise against', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-clock', [
			integrationBroadcastGraphic('a', integrationGraphicAnimation({ enter: 5000 })),
		]);

		const taken = await harness.send({
			commandId: playoutCommandId('clock-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		const clock = await $fetch<{ serverTime: number }>('/api/time');

		// An output must not subtract two clocks it does not own. It gets the authoritative
		// one from `/api/time`, which is what `useServerTime` synchronises against — so the
		// thing that has to be true is that acceptance stamps effective start times on *that
		// same* clock. If it did not, every output would project against a schedule from a
		// clock it had no way to correct for.
		const startedAt = taken.currentState.playout.a!.effectiveStartedAt;
		expect(clock.serverTime).toBeGreaterThanOrEqual(startedAt);
		expect(clock.serverTime - startedAt).toBeLessThan(60_000);
	});

	it('reverses an entrance that Out interrupted, bounded by the entrance itself', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-reverse', [
			integrationBroadcastGraphic('a', integrationGraphicAnimation({ enter: 5000, exit: 5000 })),
		]);

		const taken = await harness.send({
			commandId: playoutCommandId('reverse-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		const outed = await harness.send({
			commandId: playoutCommandId('reverse-out'),
			type: 'Out',
			payload: { graphicId: 'a' },
		});

		const record = outed.currentState.playout.a!;
		const startedAt = taken.currentState.playout.a!.effectiveStartedAt;

		expect(Object.keys(record).toSorted())
			.toEqual(['cut', 'effectiveStartedAt', 'onAir', 'reversalCompletesAt']);
		// The reversal unwinds exactly as much of the entrance as had played, so it
		// completes as far after Out as Out was after Take.
		expect(record.reversalCompletesAt!).toBe(record.effectiveStartedAt + (record.effectiveStartedAt - startedAt));
		expect(record.reversalCompletesAt! - record.effectiveStartedAt).toBeLessThanOrEqual(5000);
	});

	it('records no reversal once the phase it would reverse has completed', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-no-reverse', [
			integrationBroadcastGraphic('a', integrationGraphicAnimation({ enter: 50, exit: 5000 })),
		]);

		await harness.send({
			commandId: playoutCommandId('no-reverse-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		await new Promise((resolve) => {
			setTimeout(resolve, 300);
		});
		const outed = await harness.send({
			commandId: playoutCommandId('no-reverse-out'),
			type: 'Out',
			payload: { graphicId: 'a' },
		});

		// A settled entrance is not interrupted, so this is an ordinary exit — and the
		// durable record is the three fields it has always been.
		expect(Object.keys(outed.currentState.playout.a!).toSorted())
			.toEqual(['cut', 'effectiveStartedAt', 'onAir']);
	});

	it('defers an acceptance during enter to one update at the entrance completion', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-coalesce', [
			integrationBroadcastGraphicWithInputs(
				'a',
				[integrationTextInput('name'), integrationTextInput('title')],
				integrationGraphicAnimation({ enter: 5000, update: 1000 }),
			),
		]);

		const taken = await harness.send({
			commandId: playoutCommandId('coalesce-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'First');
		const first = await harness.send({
			commandId: playoutCommandId('coalesce-update-1'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 1 },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'Second');
		const second = await harness.send({
			commandId: playoutCommandId('coalesce-update-2'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 2 },
		});

		const enterStartedAt = taken.currentState.playout.a!.effectiveStartedAt;
		// Both acceptances land in one update, scheduled for the instant the entrance
		// completes — and the entrance schedule itself is untouched.
		expect(first.currentState.playout.a!.updateStartedAt).toBe(enterStartedAt + 5000);
		expect(second.currentState.playout.a!.updateStartedAt).toBe(enterStartedAt + 5000);
		expect(second.currentState.playout.a!.effectiveStartedAt).toBe(enterStartedAt);
		// One transition, from what it entered with straight to the latest values.
		expect(second.currentState.inputs.a!.updateFrom).toEqual({ name: '', title: '' });
		expect(second.currentState.inputs.a!.pendingUpdateFrom).toBeUndefined();
		expect(second.currentState.inputs.a!.accepted).toEqual({ name: 'Second', title: '' });
	});

	it('holds an acceptance during a running update as exactly one pending rendering', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-pending', [
			integrationBroadcastGraphicWithInputs(
				'a',
				[integrationTextInput('name'), integrationTextInput('title')],
				integrationGraphicAnimation({ update: 5000 }),
			),
		]);

		await harness.send({
			commandId: playoutCommandId('pending-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'First');
		await harness.send({
			commandId: playoutCommandId('pending-update-1'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 1 },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'Second');
		await harness.send({
			commandId: playoutCommandId('pending-update-2'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 2 },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'Third');
		const third = await harness.send({
			commandId: playoutCommandId('pending-update-3'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 3 },
		});

		const inputs = third.currentState.inputs.a!;
		// Two transitions and no more: the third acceptance replaced the pending
		// rendering's target rather than lengthening a queue.
		expect(inputs.updateFrom).toEqual({ name: '', title: '' });
		expect(inputs.pendingUpdateFrom).toEqual({ name: 'First', title: '' });
		expect(inputs.accepted).toEqual({ name: 'Third', title: '' });
		expect(inputs.acceptedRevision).toBe(4);
	});

	it('shows a Cut Update immediately while preserving the enter schedule', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-cut-update', [
			integrationBroadcastGraphicWithInputs(
				'a',
				[integrationTextInput('name'), integrationTextInput('title')],
				integrationGraphicAnimation({ enter: 5000, update: 1000 }),
			),
		]);

		const taken = await harness.send({
			commandId: playoutCommandId('cut-update-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'Swapped');
		const cut = await harness.send({
			commandId: playoutCommandId('cut-update'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', cut: true, basedOnAcceptedRevision: 1 },
		});

		// The new rendering is on screen at once, the entrance carries on unchanged, and
		// nothing is left pending for those values.
		expect(cut.currentState.playout.a!.effectiveStartedAt)
			.toBe(taken.currentState.playout.a!.effectiveStartedAt);
		expect(cut.currentState.playout.a!.updateStartedAt).toBeUndefined();
		expect(cut.currentState.inputs.a!.updateFrom).toBeUndefined();
		expect(cut.currentState.inputs.a!.accepted).toEqual({ name: 'Swapped', title: '' });
	});

	it('discards a pending visual update on Out while keeping its accepted values', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-exit-discards', [
			integrationBroadcastGraphicWithInputs(
				'a',
				[integrationTextInput('name'), integrationTextInput('title')],
				integrationGraphicAnimation({ update: 5000, exit: 5000 }),
			),
		]);

		await harness.send({
			commandId: playoutCommandId('discard-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'Accepted');
		await harness.send({
			commandId: playoutCommandId('discard-update'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 1 },
		});
		const outed = await harness.send({
			commandId: playoutCommandId('discard-out'),
			type: 'Out',
			payload: { graphicId: 'a' },
		});

		expect(outed.currentState.playout.a!.updateStartedAt).toBeUndefined();
		expect(outed.currentState.inputs.a!.accepted).toEqual({ name: 'Accepted', title: '' });
	});

	it('answers a reload with the same schedule, so a reconnecting output catches up', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-reload-schedule', [
			integrationBroadcastGraphicWithInputs(
				'a',
				[integrationTextInput('name'), integrationTextInput('title')],
				integrationGraphicAnimation({ enter: 5000, update: 5000 }),
			),
		]);

		await harness.send({
			commandId: playoutCommandId('reload-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		await setBroadcastGraphicInput(harness, 'a', 'name', 'Reloaded');
		const accepted = await harness.send({
			commandId: playoutCommandId('reload-update'),
			type: 'Update Graphic',
			payload: { graphicId: 'a', basedOnAcceptedRevision: 1 },
		});

		const reloaded = await harness.reload();

		// Byte-for-byte the same schedule and the same pair of renderings, so an output
		// that joins mid-update draws the transition rather than cutting to the end of it.
		expect(reloaded.currentState.playout.a).toEqual(accepted.currentState.playout.a);
		expect(reloaded.currentState.inputs.a).toEqual(accepted.currentState.inputs.a);
	});
});
