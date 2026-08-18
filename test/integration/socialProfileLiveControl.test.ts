import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SOCIAL_PROFILE_HANDLE_LENGTH } from '../../shared/socialProfiles';
import {
	createGraphicsHarness,
	getBroadcastGraphicsLiveSession,
	playoutCommandId,
	selectBroadcastGraphicSource,
	sendBroadcastGraphicsCommand,
} from './broadcastGraphicsPlayoutHelpers';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';
import { executeIntegrationD1 } from './integrationD1';

const GRAPHIC_ID = 'talent-lower-third';
const PROJECTION_KEY = 'profile';

function socialProfileGraphic(): BroadcastGraphicConfig {
	const square = { treatment: 'square' as const, size: 0 };

	return {
		id: GRAPHIC_ID,
		name: 'Talent lower third',
		sources: [{ key: 'talent', label: 'Talent', kind: 'talent' }],
		socialProfileProjections: [{
			key: PROJECTION_KEY,
			label: 'Social Profile',
			sourceKey: 'talent',
			presentationGroupId: 'profile-group',
			dwellMs: 8_000,
			transition: 'crossfade',
			transitionDurationMs: 250,
		}],
		items: [{
			id: 'profile-group',
			label: 'Social Profile',
			type: 'group',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 640,
			height: 120,
			arrangement: 'row',
			padding: 0,
			gap: 16,
			align: 'center',
			justify: 'start',
			clip: false,
			geometry: {
				topLeft: square,
				topRight: square,
				bottomRight: square,
				bottomLeft: square,
				leftSlant: 0,
				rightSlant: 0,
			},
			children: [],
		}],
	};
}

function derivedSocialProfileGraphic(
	graphicId: string,
	sourceKey: string,
	relation: 'commentator1' | 'commentator2',
): BroadcastGraphicConfig {
	const graphic = socialProfileGraphic();
	return {
		...graphic,
		id: graphicId,
		sources: [
			{ key: 'event', label: 'Event', kind: 'event' },
			{ key: sourceKey, label: relation === 'commentator1' ? 'Talent 1' : 'Talent 2', kind: 'talent', from: { sourceKey: 'event', relation } },
		],
		socialProfileProjections: graphic.socialProfileProjections?.map(projection => ({
			...projection,
			sourceKey,
		})),
	};
}

describe('manual Social Profile Projection command API', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Social Profile Live Control', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('takes the first accepted profile of an operator-selected Talent through the real command route', async () => {
		const talent = await $fetch<{ id: number; name: string }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Avery Quinn',
				socialProfiles: { youtube: 'AveryCasts', twitch: 'AveryLive' },
			},
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-take', [socialProfileGraphic()]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});

		expect((taken.currentState as typeof taken.currentState & {
			socialProfileProjections: Record<string, Record<string, unknown>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toEqual({
			talent: { id: talent.id, name: 'Avery Quinn' },
			acceptedProfiles: [
				{
					network: 'twitch',
					networkLabel: 'Twitch',
					handle: 'AveryLive',
					profileUrl: 'https://www.twitch.tv/AveryLive',
				},
				{
					network: 'youtube',
					networkLabel: 'YouTube',
					handle: 'AveryCasts',
					profileUrl: 'https://www.youtube.com/@AveryCasts',
				},
			],
			currentNetwork: 'twitch',
		});
	});

	it('resolves Talent 1 and Talent 2 sources with one and zero populated profiles', async () => {
		const talent1 = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Taylor Brooks', socialProfiles: { twitch: 'TaylorLive' } },
		});
		const talent2 = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Casey Park', socialProfiles: {} },
		});
		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { commentator1TalentId: talent1.id, commentator2TalentId: talent2.id },
		});
		const talent1Graphic = derivedSocialProfileGraphic('talent-1-profile', 'talent1', 'commentator1');
		const talent2Graphic = derivedSocialProfileGraphic('talent-2-profile', 'talent2', 'commentator2');
		const harness = await createGraphicsHarness(eventId, 'social-profile-derived', [talent1Graphic, talent2Graphic]);

		const one = await harness.send({
			commandId: playoutCommandId('social-profile-derived-one'),
			type: 'Take',
			payload: { graphicId: talent1Graphic.id },
		});
		expect(one.currentState.socialProfileProjections?.[talent1Graphic.id]?.[PROJECTION_KEY]).toEqual({
			talent: { id: talent1.id, name: 'Taylor Brooks' },
			acceptedProfiles: [{
				network: 'twitch',
				networkLabel: 'Twitch',
				handle: 'TaylorLive',
				profileUrl: 'https://www.twitch.tv/TaylorLive',
			}],
			currentNetwork: 'twitch',
		});

		const zero = await harness.send({
			commandId: playoutCommandId('social-profile-derived-zero'),
			type: 'Take',
			payload: { graphicId: talent2Graphic.id },
		});
		expect(zero.currentState.socialProfileProjections?.[talent2Graphic.id]?.[PROJECTION_KEY]).toEqual({
			talent: { id: talent2.id, name: 'Casey Park' },
			acceptedProfiles: [],
		});
	});

	it('omits a legacy over-bound profile without creating an unreadable live session', async () => {
		const talent = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Legacy Long Handle', socialProfiles: { twitch: 'before-migration' } },
		});
		const legacyHandle = 'a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH + 1);
		await executeIntegrationD1(
			`UPDATE event_talents SET twitch_handle = '${legacyHandle}' WHERE id = ${talent.id};`,
		);
		const harness = await createGraphicsHarness(eventId, 'social-profile-legacy-bound', [socialProfileGraphic()]);
		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);

		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-legacy-bound-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		expect(taken.session.recoveryFault).toBeNull();
		expect(taken.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY]).toEqual({
			talent: { id: talent.id, name: 'Legacy Long Handle' },
			acceptedProfiles: [],
		});

		const reloaded = await harness.reload();
		expect(reloaded.recoveryFault).toBeNull();
		expect(reloaded.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY])
			.toEqual(taken.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY]);
	});

	it('selects one accepted profile directly as an authoritative manual command', async () => {
		const talent = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Morgan Lee',
				socialProfiles: { twitch: 'MorganLive', x: 'MorganCasts', bluesky: 'morgan.example' },
			},
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-direct', [socialProfileGraphic()]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-direct-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		const takenProjection = (taken.currentState as typeof taken.currentState & {
			socialProfileProjections: Record<string, Record<string, {
				acceptedProfiles: Array<{ network: string }>;
			}>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(takenProjection?.acceptedProfiles.map(profile => profile.network)).toEqual([
			'twitch',
			'x',
			'bluesky',
		]);
		const selected = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: playoutCommandId('social-profile-direct-select'),
					type: 'Select Social Profile',
					payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' },
				},
				ignoreResponseError: true,
			},
		);

		expect(selected).toMatchObject({ status: 200 });
		expect((selected._data.currentState as typeof selected._data.currentState & {
			socialProfileProjections: Record<string, Record<string, unknown>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'x',
			manualNetwork: 'x',
		});
	});

	it('refuses an unavailable profile and an unknown authored projection without changing state', async () => {
		const talent = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Drew Kim', socialProfiles: { twitch: 'DrewLive' } },
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-refusal', [socialProfileGraphic()]);
		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-refusal-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		const commandUrl = `/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`;
		const unavailable = await $fetchRaw(commandUrl, {
			method: 'POST',
			body: {
				commandId: playoutCommandId('social-profile-refusal-unavailable'),
				type: 'Select Social Profile',
				payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' },
			},
			ignoreResponseError: true,
		});
		const unknown = await $fetchRaw(commandUrl, {
			method: 'POST',
			body: {
				commandId: playoutCommandId('social-profile-refusal-unknown'),
				type: 'Next Social Profile',
				payload: { graphicId: GRAPHIC_ID, projectionKey: 'missing' },
			},
			ignoreResponseError: true,
		});

		expect(unavailable).toMatchObject({ status: 409, _data: { data: { code: 'social-profile-unavailable' } } });
		expect(unknown).toMatchObject({ status: 404, _data: { data: { code: 'unknown-social-profile-projection' } } });
		const unchanged = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
		expect(unchanged.sequence).toBe(taken.sequence);
		expect(unchanged.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY]?.currentNetwork)
			.toBe('twitch');
	});

	it('wraps Previous and Next through only the populated accepted profiles', async () => {
		const talent = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Riley Chen',
				socialProfiles: { twitch: 'RileyLive', instagram: 'RileyCoverage', bluesky: 'riley.example' },
			},
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-step', [socialProfileGraphic()]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		await harness.send({
			commandId: playoutCommandId('social-profile-step-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		const previous = await harness.send({
			commandId: playoutCommandId('social-profile-previous'),
			type: 'Previous Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY },
		} as never);
		expect((previous.currentState as typeof previous.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]?.currentNetwork).toBe('bluesky');

		const next = await harness.send({
			commandId: playoutCommandId('social-profile-next'),
			type: 'Next Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY },
		} as never);
		expect((next.currentState as typeof next.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string; manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'twitch',
			manualNetwork: 'twitch',
		});
	});

	it('replays a retried manual command without overwriting the newest accepted intent', async () => {
		const talent = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Jordan Vale',
				socialProfiles: { twitch: 'JordanLive', x: 'JordanCasts', bluesky: 'jordan.example' },
			},
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-retry', [socialProfileGraphic()]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		await harness.send({
			commandId: playoutCommandId('social-profile-retry-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		const directCommand = {
			commandId: playoutCommandId('social-profile-retry-direct'),
			type: 'Select Social Profile' as const,
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' as const },
		};
		await harness.send(directCommand);
		const newest = await harness.send({
			commandId: playoutCommandId('social-profile-retry-next'),
			type: 'Next Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY },
		} as never);
		const replay = await sendBroadcastGraphicsCommand(
			eventId,
			harness.screen.id,
			harness.session().id,
			directCommand,
		);

		// A receipt suppresses a repeated reduction but answers with the authoritative
		// snapshot at the time of the retry. That is what prevents an old response from
		// making the caller believe its older intent became newest again.
		expect(replay.sequence).toBe(newest.sequence);
		expect((replay.currentState as typeof replay.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]?.currentNetwork).toBe('bluesky');
		const authoritative = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
		expect(authoritative.sequence).toBe(newest.sequence);
		expect((authoritative.currentState as typeof authoritative.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string; manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'bluesky',
			manualNetwork: 'bluesky',
		});
	});

	it('survives hide, reload, and reconnect in one session, then reset clears the manual choice', async () => {
		const talent = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Sam Torres',
				socialProfiles: { twitch: 'SamLive', x: 'SamCasts' },
			},
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-reset', [socialProfileGraphic()]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		await harness.send({
			commandId: playoutCommandId('social-profile-reset-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		await harness.send({
			commandId: playoutCommandId('social-profile-reset-select'),
			type: 'Select Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' },
		} as never);
		await harness.send({
			commandId: playoutCommandId('social-profile-reset-out'),
			type: 'Out',
			payload: { graphicId: GRAPHIC_ID },
		});
		const retaken = await harness.send({
			commandId: playoutCommandId('social-profile-reset-retake'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		expect((retaken.currentState as typeof retaken.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string; manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'x',
			manualNetwork: 'x',
		});

		const reloaded = await harness.reload();
		expect((reloaded.currentState as typeof reloaded.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string; manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'x',
			manualNetwork: 'x',
		});

		const reset = await $fetch<Awaited<ReturnType<typeof harness.reload>>>(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-session/reset`,
			{ method: 'POST' },
		);
		expect(reset.currentState).toEqual({ playout: {}, inputs: {}, sources: {} });
		await sendBroadcastGraphicsCommand(eventId, harness.screen.id, reset.id, {
			commandId: playoutCommandId('social-profile-reset-reselect-source'),
			type: 'Select Source',
			payload: { graphicId: GRAPHIC_ID, sourceKey: 'talent', selectionId: talent.id },
		});
		const afterReset = await sendBroadcastGraphicsCommand(eventId, harness.screen.id, reset.id, {
			commandId: playoutCommandId('social-profile-reset-after'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		expect((afterReset.currentState as typeof afterReset.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string; manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'twitch',
		});
		expect((afterReset.currentState as typeof afterReset.currentState & {
			socialProfileProjections: Record<string, Record<string, { manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]?.manualNetwork).toBeUndefined();
	});
});
