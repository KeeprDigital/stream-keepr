import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createGraphicsHarness,
	integrationBroadcastGraphic,
	integrationGraphicAnimation,
	playoutCommandId,
} from './broadcastGraphicsPlayoutHelpers';

/**
 * Graphic Channels, proven through the authoritative surface: one command in, the
 * authoritative snapshot out.
 *
 * A Graphic Channel is the one thing in playout whose effect reaches past the
 * Broadcast Graphic a command names, and the handoff it performs is decided at
 * acceptance — against the Screen's authored channels and every member's own phase
 * durations. So these are the tests that prove the channel actually reaches the
 * reducer, rather than an operator's browser deciding a handoff for itself.
 *
 * The instants are the assertion. Under Overlap the outgoing exit and the incoming
 * enter carry the same effective start time, which is what "at the same logical
 * instant" means where every output reads it; under Out then in the incoming enter
 * carries the outgoing exit's scheduled completion, which is what holds it waiting
 * until then.
 */

const EXIT_MS = 5000;
const ENTER_MS = 5000;
/** Long enough for the incumbent's brief entrance to have completed before it is replaced. */
const SETTLE_MS = 300;

/**
 * A member of one Graphic Channel, with an exit long enough to catch mid-flight.
 *
 * `incumbent` shortens only the entrance, so a Take can settle it on air within one
 * test and the graphic that replaces it runs a whole exit rather than reversing a few
 * milliseconds of entrance. That distinction is the point of several of these tests:
 * an Out then in handoff waits for whatever the outgoing graphic is actually
 * scheduled to finish, which for an interrupted entrance is much sooner.
 */
function member(id: string, channelId: string, incumbent = false): BroadcastGraphicConfig {
	return {
		...integrationBroadcastGraphic(
			id,
			integrationGraphicAnimation({ enter: incumbent ? 50 : ENTER_MS, exit: EXIT_MS }),
		),
		channelId,
	};
}

/** Let an incumbent's entrance complete, so replacing it schedules a whole exit. */
async function settle(): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, SETTLE_MS);
	});
}

const OVERLAP: GraphicChannelConfig = { id: 'thirds', name: 'Lower thirds' };
const OUT_THEN_IN: GraphicChannelConfig = { id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' };

describe('broadcast graphics Graphic Channel handoffs', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Graphic Channels Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	async function channelHarness(slug: string, channel: GraphicChannelConfig) {
		return await createGraphicsHarness(
			eventId,
			slug,
			[member('a', 'thirds', true), member('b', 'thirds'), member('c', 'thirds')],
			[channel],
		);
	}

	async function take(
		harness: Awaited<ReturnType<typeof channelHarness>>,
		graphicId: string,
		cut = false,
	) {
		return await harness.send({
			commandId: playoutCommandId(`take-${graphicId}`),
			type: 'Take',
			payload: { graphicId, cut },
		});
	}

	it('outs the incumbent before the newcomer enters, under Out then in', async () => {
		const harness = await channelHarness('channel-out-then-in', OUT_THEN_IN);
		await take(harness, 'a');
		await settle();

		const state = (await take(harness, 'b')).currentState.playout;

		// The incumbent is on its way off program, and the newcomer's entrance is
		// scheduled at exactly the instant that exit completes — so it is held off every
		// output until then rather than overlapping it.
		expect(state.a).toMatchObject({ onAir: false, cut: false });
		expect(state.b).toMatchObject({ onAir: true, cut: false });
		expect(state.b!.effectiveStartedAt).toBe(state.a!.effectiveStartedAt + EXIT_MS);
	});

	it('begins the outgoing exit and the incoming enter together, under Overlap', async () => {
		const harness = await channelHarness('channel-overlap', OVERLAP);
		await take(harness, 'a');
		await settle();

		const state = (await take(harness, 'b')).currentState.playout;

		expect(state.a).toMatchObject({ onAir: false, cut: false });
		expect(state.b!.effectiveStartedAt).toBe(state.a!.effectiveStartedAt);
	});

	it('retains only the latest selection: a new Take replaces the graphic still waiting', async () => {
		const harness = await channelHarness('channel-latest', OUT_THEN_IN);
		await take(harness, 'a');
		await settle();
		const first = (await take(harness, 'b')).currentState.playout;

		const state = (await take(harness, 'c')).currentState.playout;

		// The replaced graphic never reached program, so it settles off without running an
		// exit it never earned — and the outgoing graphic finishes on the schedule it
		// already had, which the latest selection inherits rather than queueing behind.
		expect(state.b).toMatchObject({ onAir: false, cut: true });
		expect(state.a!.effectiveStartedAt).toBe(first.a!.effectiveStartedAt);
		expect(state.c!.effectiveStartedAt).toBe(first.b!.effectiveStartedAt);
	});

	it('reverses the current incoming graphic and cuts off the older outgoing one, under Overlap', async () => {
		const harness = await channelHarness('channel-three', OVERLAP);
		await take(harness, 'a');
		await settle();
		await take(harness, 'b');

		const state = (await take(harness, 'c')).currentState.playout;

		// The current incoming graphic unwinds its entrance from where it had reached.
		expect(state.b).toMatchObject({ onAir: false, cut: false });
		expect(state.b!.reversalCompletesAt).toBeDefined();
		// The older outgoing graphic is cut off, so a channel racing through three graphics
		// never accumulates exits nobody is handing over to any more.
		expect(state.a).toMatchObject({ onAir: false, cut: true });
	});

	it('cancels a waiting Take on Out, without scheduling an exit for a graphic that never entered', async () => {
		const harness = await channelHarness('channel-cancel', OUT_THEN_IN);
		await take(harness, 'a');
		await settle();
		await take(harness, 'b');

		const state = (await harness.send({
			commandId: playoutCommandId('cancel-out'),
			type: 'Out',
			payload: { graphicId: 'b' },
		})).currentState.playout;

		expect(state.b).toMatchObject({ onAir: false, cut: true });
		expect(state.b!.reversalCompletesAt).toBeUndefined();
	});

	it('brings the waiting graphic forward when Cut Out ends the exit it was waiting for', async () => {
		const harness = await channelHarness('channel-cut-out', OUT_THEN_IN);
		await take(harness, 'a');
		await settle();
		const handed = (await take(harness, 'b')).currentState.playout;

		const state = (await harness.send({
			commandId: playoutCommandId('cut-out-a'),
			type: 'Out',
			payload: { graphicId: 'a', cut: true },
		})).currentState.playout;

		// The outgoing exit's authoritative scheduled completion is now, so that is where
		// the incoming enter begins — rather than staying at the instant the Take
		// scheduled, which would hold the graphic off program for the exit's whole
		// remaining run and then drop it on already settled.
		expect(state.a).toMatchObject({ onAir: false, cut: true });
		expect(state.b!.effectiveStartedAt).toBe(state.a!.effectiveStartedAt);
		expect(state.b!.effectiveStartedAt).toBeLessThan(handed.b!.effectiveStartedAt);
	});

	it('leaves a waiting graphic where it is when a plain Out restates an exit already running', async () => {
		const harness = await channelHarness('channel-plain-out', OUT_THEN_IN);
		await take(harness, 'a');
		await settle();
		const handed = (await take(harness, 'b')).currentState.playout;

		const state = (await harness.send({
			commandId: playoutCommandId('plain-out-a'),
			type: 'Out',
			payload: { graphicId: 'a' },
		})).currentState.playout;

		expect(state).toEqual(handed);
	});

	it('performs the handoff immediately on Cut Take, bypassing the Handoff Policy', async () => {
		const harness = await channelHarness('channel-cut', OUT_THEN_IN);
		const taken = await take(harness, 'a');
		await settle();

		const state = (await take(harness, 'b', true)).currentState.playout;

		expect(state.a).toMatchObject({ onAir: false, cut: true });
		expect(state.b).toMatchObject({ onAir: true, cut: true });
		// No deferral at all: the newcomer starts when the command was accepted, not when
		// the outgoing exit would have completed.
		expect(state.b!.effectiveStartedAt).toBe(state.a!.effectiveStartedAt);
		expect(state.b!.effectiveStartedAt).toBeGreaterThanOrEqual(taken.currentState.playout.a!.effectiveStartedAt);
	});

	it('is idempotent: a duplicate Take neither restarts the newcomer nor disturbs the exit it started', async () => {
		const harness = await channelHarness('channel-idempotent', OVERLAP);
		await take(harness, 'a');
		await settle();
		const once = (await take(harness, 'b')).currentState.playout;

		const twice = (await take(harness, 'b')).currentState.playout;

		expect(twice).toEqual(once);
	});

	it('leaves a Broadcast Graphic in another Graphic Channel, or in none, running concurrently', async () => {
		const harness = await createGraphicsHarness(
			eventId,
			'channel-concurrent',
			[
				member('a', 'thirds', true),
				member('b', 'thirds'),
				member('slate', 'slates'),
				integrationBroadcastGraphic('bug', integrationGraphicAnimation({ enter: ENTER_MS, exit: EXIT_MS })),
			],
			[OUT_THEN_IN, { id: 'slates', name: 'Slates' }],
		);
		await take(harness, 'a');
		await take(harness, 'slate');
		await take(harness, 'bug');
		await settle();

		const state = (await take(harness, 'b')).currentState.playout;

		expect(state.a).toMatchObject({ onAir: false });
		expect(state.slate).toMatchObject({ onAir: true });
		expect(state.bug).toMatchObject({ onAir: true });
	});

	it('replaces nothing when a Broadcast Graphic names a Graphic Channel the Screen does not declare', async () => {
		// Membership that resolves to nothing is no membership: the Screen has to declare
		// the lane for two graphics to be mutually exclusive in it.
		const harness = await createGraphicsHarness(
			eventId,
			'channel-undeclared',
			[member('a', 'deleted', true), member('b', 'deleted')],
		);
		await take(harness, 'a');
		await settle();
		await settle();

		const state = (await take(harness, 'b')).currentState.playout;

		expect(state.a).toMatchObject({ onAir: true });
		expect(state.b).toMatchObject({ onAir: true });
	});

	it('recovers a Screen mid-handoff with both members settled, and nothing replayed', async () => {
		const harness = await createGraphicsHarness(
			eventId,
			'channel-recovery',
			[member('a', 'thirds', true), member('b', 'thirds')],
			[OUT_THEN_IN],
		);
		await take(harness, 'a');
		await settle();
		const handed = (await take(harness, 'b')).currentState.playout;

		const reloaded = await harness.reload();

		// The snapshot is the authority a reconnecting output reloads, and it carries the
		// same two instants — so a client that arrives after the handoff resolves the
		// current phase rather than replaying it.
		expect(reloaded.currentState.playout.a).toEqual(handed.a);
		expect(reloaded.currentState.playout.b).toEqual(handed.b);
		expect(Object.keys(reloaded.currentState.playout.b!).toSorted())
			.toEqual(['cut', 'effectiveStartedAt', 'onAir']);
	});
});
