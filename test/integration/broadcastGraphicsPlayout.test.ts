import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
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
import { $fetch } from './client';
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

	it('rejects a playout action for a Broadcast Graphic the Screen does not place', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-unknown', ['a']);

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: playoutCommandId('unknown'),
					type: 'Take',
					payload: { graphicId: 'nope' },
				},
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(404);
	});

	it('ends the Live Session when the Screen leaves Broadcast Graphics mode and rejects its stale commands', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-epoch', ['a']);
		const endedSessionId = harness.session().id;
		await harness.send({
			commandId: playoutCommandId('epoch-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});

		await setScreenMode(eventId, harness.screen.id, 'background');
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
				body: {
					commandId: playoutCommandId('epoch-stale'),
					type: 'Out',
					payload: { graphicId: 'a' },
				},
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
			[
				integrationBroadcastGraphic('a'),
			],
		);

		const opened = await Promise.all(
			Array.from({ length: 6 }, () => getBroadcastGraphicsLiveSession(eventId, screen.id)),
		);

		expect(new Set(opened.map(session => session.id)).size).toBe(1);
		expect(opened.every(session => session.status === 'active')).toBe(true);
	});

	it('refuses a snapshot for a Screen that is not in Broadcast Graphics mode', async () => {
		const harness = await createPlayoutHarness(eventId, 'playout-wrong-mode', ['a']);
		await setScreenMode(eventId, harness.screen.id, 'background');

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

		const serverTime = async () => (await $fetch<{ serverTime: number }>('/api/time')).serverTime;

		const before = await serverTime();
		const taken = await harness.send({
			commandId: playoutCommandId('clock-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		const after = await serverTime();

		// An output must not subtract two clocks it does not own. It gets the authoritative
		// one from `/api/time`, which is what `useServerTime` synchronises against — so the
		// thing that has to be true is that acceptance stamps effective start times on *that
		// same* clock. If it did not, every output would project against a schedule from a
		// clock it had no way to correct for.
		// Read on either side of the Take, so the bracket is as wide as the requests took
		// and no wider: a start time stamped on any other clock falls outside it.
		const startedAt = taken.currentState.playout.a!.effectiveStartedAt;
		expect(startedAt).toBeGreaterThanOrEqual(before);
		expect(startedAt).toBeLessThanOrEqual(after);
	});

	it('reverses an entrance that Out interrupted, bounded by the entrance itself', async () => {
		// The longest entrance an author may write: Out has to land inside it to interrupt it.
		const harness = await createGraphicsHarness(eventId, 'playout-reverse', [
			integrationBroadcastGraphic('a', integrationGraphicAnimation({ enter: 10_000, exit: 10_000 })),
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
			.toEqual([
				'cut',
				'effectiveStartedAt',
				'onAir',
				'reversalCompletesAt',
			]);
		// The reversal unwinds exactly as much of the entrance as had played, so it
		// completes as far after Out as Out was after Take.
		expect(record.reversalCompletesAt!).toBe(record.effectiveStartedAt + (record.effectiveStartedAt - startedAt));
		expect(record.reversalCompletesAt! - record.effectiveStartedAt).toBeLessThanOrEqual(10_000);
	});

	it('carries where on-screen cycling had reached into the exit that interrupted it', async () => {
		// Exit interrupts an active on-screen recipe and continues smoothly from the state
		// that was rendered. The record an exit writes says when the *exit* began, so the
		// instant cycling's origin was derived from is gone — and an exit composed over a
		// cycle it cannot locate starts from the Graphic Resting State, which is the snap.
		// The origin is therefore carried, and it is carried in the snapshot every output
		// and Live Control reloads, so they cannot disagree about where the cycle is.
		const harness = await createGraphicsHarness(eventId, 'playout-exit-cycling', [
			integrationBroadcastGraphicWithInputs(
				'a',
				[
					integrationTextInput('name'),
				],
				integrationGraphicAnimation({ onScreen: 5000, exit: 5000 }),
			),
		]);

		const taken = await harness.send({
			commandId: playoutCommandId('cycling-take'),
			type: 'Take',
			payload: { graphicId: 'a' },
		});
		const outed = await harness.send({
			commandId: playoutCommandId('cycling-out'),
			type: 'Out',
			payload: { graphicId: 'a' },
		});

		// No enter recipe, so cycling began the instant the Take settled — and that is the
		// instant the exit now carries.
		expect(outed.currentState.playout.a!.cyclingStartedAt)
			.toBe(taken.currentState.playout.a!.effectiveStartedAt);
		expect(outed.currentState.playout.a!.onAir).toBe(false);

		// Every reader reloads the same origin rather than deriving one of its own.
		const reloaded = await harness.reload();
		expect(reloaded.currentState.playout.a!.cyclingStartedAt)
			.toBe(outed.currentState.playout.a!.cyclingStartedAt);
	});

	it('answers a reload with the same schedule, so a reconnecting output catches up', async () => {
		const harness = await createGraphicsHarness(eventId, 'playout-reload-schedule', [
			integrationBroadcastGraphicWithInputs(
				'a',
				[
					integrationTextInput('name'),
					integrationTextInput('title'),
				],
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

	/**
	 * A Take in a Graphic Channel reaches past the Broadcast Graphic it names, so these
	 * prove the Screen's authored channels and every member's durations reach the reducer.
	 * The instants are the assertion; each further handoff branch is the reducer's own.
	 */
	describe('handing off within a Graphic Channel', () => {
		const INCUMBENT_ENTER_MS = 50;
		const HANDOFF_PHASE_MS = 5000;

		/** The incumbent's entrance is brief, so replacing it runs a whole exit, not a reversal. */
		function member(id: string, incumbent = false): BroadcastGraphicConfig {
			return {
				...integrationBroadcastGraphic(
					id,
					integrationGraphicAnimation({
						enter: incumbent ? INCUMBENT_ENTER_MS : HANDOFF_PHASE_MS,
						exit: HANDOFF_PHASE_MS,
					}),
				),
				channelId: 'thirds',
			};
		}

		/** Past an instant on the clock that stamped it, rather than a sleep bet against it. */
		async function serverClockPasses(instant: number): Promise<void> {
			for (;;) {
				const { serverTime } = await $fetch<{ serverTime: number }>('/api/time');
				if (serverTime > instant)
					return;
				await new Promise((resolve) => {
					setTimeout(resolve, instant - serverTime + 1);
				});
			}
		}

		/** The playout a Take of the newcomer answers with, once the incumbent has settled on air. */
		async function handOff(slug: string, channel: GraphicChannelConfig) {
			const harness = await createGraphicsHarness(
				eventId,
				slug,
				[
					member('a', true),
					member('b'),
				],
				[channel],
			);
			const incumbent = await harness.send({
				commandId: playoutCommandId('take-a'),
				type: 'Take',
				payload: { graphicId: 'a' },
			});
			await serverClockPasses(incumbent.currentState.playout.a!.effectiveStartedAt + INCUMBENT_ENTER_MS);

			return (await harness.send({
				commandId: playoutCommandId('take-b'),
				type: 'Take',
				payload: { graphicId: 'b' },
			})).currentState.playout;
		}

		it('outs the incumbent before the newcomer enters, under Out then in', async () => {
			const state = await handOff('channel-out-then-in', { id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' });

			// The newcomer's entrance is scheduled at exactly the instant the incumbent's exit
			// completes, so it is held off every output until then rather than overlapping it.
			expect(state.a).toMatchObject({ onAir: false, cut: false });
			expect(state.b).toMatchObject({ onAir: true, cut: false });
			expect(state.b!.effectiveStartedAt).toBe(state.a!.effectiveStartedAt + HANDOFF_PHASE_MS);
		});

		it('begins the outgoing exit and the incoming enter together, under Overlap', async () => {
			const state = await handOff('channel-overlap', { id: 'thirds', name: 'Lower thirds' });

			expect(state.a).toMatchObject({ onAir: false, cut: false });
			expect(state.b!.effectiveStartedAt).toBe(state.a!.effectiveStartedAt);
		});
	});
});
