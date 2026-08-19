import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SOCIAL_PROFILE_HANDLE_LENGTH } from '../../shared/socialProfiles';
import {
	createGraphicsHarness,
	getBroadcastGraphicsLiveSession,
	integrationGraphicAnimation,
	playoutCommandId,
	selectBroadcastGraphicSource,
	sendBroadcastGraphicsCommand,
} from './broadcastGraphicsPlayoutHelpers';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';
import { executeIntegrationD1 } from './integrationD1';

const GRAPHIC_ID = 'talent-lower-third';
const PROJECTION_KEY = 'profile';

function socialProfileGraphic(updatePolicy?: 'staged' | 'live'): BroadcastGraphicConfig {
	const square = { treatment: 'square' as const, size: 0 };
	const projection = {
		key: PROJECTION_KEY,
		label: 'Social Profile',
		sourceKey: 'talent',
		presentationGroupId: 'profile-group',
		dwellMs: 8_000,
		transition: 'crossfade' as const,
		transitionDurationMs: 250,
		...(updatePolicy ? { updatePolicy } : {}),
	};

	return {
		id: GRAPHIC_ID,
		name: 'Talent lower third',
		sources: [{ key: 'talent', label: 'Talent', kind: 'talent' }],
		socialProfileProjections: [projection],
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
	updatePolicy?: 'staged' | 'live',
): BroadcastGraphicConfig {
	const graphic = socialProfileGraphic(updatePolicy);
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
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
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
			automatic: true,
			rotationAnchor: { network: 'twitch', anchoredAt: expect.any(Number) },
		});
	});

	it('applies a live-policy Talent profile edit without changing the current network', async () => {
		const talent = await $fetch<{ id: number; name: string }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Live Profile Edit',
				socialProfiles: { twitch: 'BeforeLive', x: 'OnAirX' },
			},
		});
		const harness = await createGraphicsHarness(
			eventId,
			'social-profile-live-reresolution',
			[socialProfileGraphic('live')],
		);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		await harness.send({
			commandId: playoutCommandId('social-profile-live-reresolution-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		await harness.send({
			commandId: playoutCommandId('social-profile-live-reresolution-select'),
			type: 'Select Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' },
		});

		await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'PATCH',
			body: {
				name: talent.name,
				socialProfiles: { twitch: 'BeforeLive', youtube: 'NewlyAdded', x: 'CorrectedX' },
			},
		});

		const refreshed = await harness.reload();
		const projection = refreshed.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(projection).toMatchObject({
			acceptedProfiles: [
				{ network: 'twitch', handle: 'BeforeLive' },
				{ network: 'youtube', handle: 'NewlyAdded' },
				{ network: 'x', handle: 'CorrectedX' },
			],
			currentNetwork: 'x',
			manualNetwork: 'x',
			transitionAnchor: { startedAt: expect.any(Number) },
		});
		expect(projection!.transitionAnchor!.from).toEqual(expect.arrayContaining([
			expect.objectContaining({
				values: expect.objectContaining({ network: 'x', handle: 'OnAirX' }),
			}),
		]));
		expect(projection!.rotationAnchor!.anchoredAt)
			.toBe(projection!.transitionAnchor!.startedAt + 250);
		await new Promise(resolve => setTimeout(resolve, 300));

		await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'PATCH',
			body: { name: talent.name, socialProfiles: { twitch: 'BeforeLive' } },
		});
		const removed = (await harness.reload()).currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(removed).toMatchObject({
			acceptedProfiles: [{ network: 'twitch', handle: 'BeforeLive' }],
			currentNetwork: 'twitch',
			transitionAnchor: { startedAt: expect.any(Number) },
		});
		expect(removed?.manualNetwork).toBeUndefined();
		await new Promise(resolve => setTimeout(resolve, 300));

		await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'PATCH',
			body: { name: talent.name, socialProfiles: {} },
		});
		const unavailable = (await harness.reload()).currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(unavailable?.acceptedProfiles).toEqual([]);
		expect(unavailable?.currentNetwork).toBeUndefined();
		expect(unavailable?.transitionAnchor?.from).toEqual([
			expect.objectContaining({ values: expect.objectContaining({ network: 'twitch' }) }),
		]);
		await new Promise(resolve => setTimeout(resolve, 300));

		await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'PATCH',
			body: { name: talent.name, socialProfiles: { youtube: 'BackOnAir' } },
		});
		const repopulated = (await harness.reload()).currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(repopulated).toMatchObject({
			acceptedProfiles: [{ network: 'youtube', handle: 'BackOnAir' }],
			currentNetwork: 'youtube',
			transitionAnchor: { startedAt: expect.any(Number), from: [] },
		});
		expect(repopulated!.rotationAnchor!.anchoredAt)
			.toBe(repopulated!.transitionAnchor!.startedAt + 250);
	});

	it('keeps a staged profile set off program and out of the picker until Update Graphic accepts it', async () => {
		const talent = await $fetch<{ id: number; name: string }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Staged Profile Edit', socialProfiles: { twitch: 'AcceptedLive' } },
		});
		const graphic = {
			...socialProfileGraphic(),
			animation: integrationGraphicAnimation({ update: 1_000 }),
		};
		const harness = await createGraphicsHarness(eventId, 'social-profile-staged-reresolution', [graphic]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-staged-reresolution-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'PATCH',
			body: { name: talent.name, socialProfiles: { youtube: 'PendingOnly' } },
		});

		const stillAccepted = await harness.reload();
		expect(stillAccepted.sequence).toBe(taken.sequence);
		expect(stillAccepted.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY])
			.toMatchObject({
				acceptedProfiles: [{ network: 'twitch', handle: 'AcceptedLive' }],
				currentNetwork: 'twitch',
			});
		const pendingSelection = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: playoutCommandId('social-profile-staged-reresolution-pending-select'),
					type: 'Select Social Profile',
					payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'youtube' },
				},
				ignoreResponseError: true,
			},
		);
		expect(pendingSelection).toMatchObject({
			status: 409,
			_data: { data: { code: 'social-profile-unavailable' } },
		});

		const updated = await harness.send({
			commandId: playoutCommandId('social-profile-staged-reresolution-update'),
			type: 'Update Graphic',
			payload: {
				graphicId: GRAPHIC_ID,
				basedOnAcceptedRevision: stillAccepted.currentState.inputs[GRAPHIC_ID]!.acceptedRevision,
			},
		});
		const accepted = updated.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(accepted).toMatchObject({
			acceptedProfiles: [{ network: 'youtube', handle: 'PendingOnly' }],
			currentNetwork: 'youtube',
		});
		expect(accepted?.manualNetwork).toBeUndefined();
		expect(accepted?.transitionAnchor).toBeUndefined();
		expect(updated.currentState.playout[GRAPHIC_ID]?.updateStartedAt).toEqual(expect.any(Number));
	});

	it('takes the latest Event Data after an off-air edit instead of replaying the previous acceptance', async () => {
		const talent = await $fetch<{ id: number; name: string }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Off-air Refresh', socialProfiles: { twitch: 'BeforeTake', x: 'BeforeManual' } },
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-off-air-latest-take', [socialProfileGraphic()]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		await harness.send({
			commandId: playoutCommandId('social-profile-off-air-latest-first-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		await harness.send({
			commandId: playoutCommandId('social-profile-off-air-latest-manual'),
			type: 'Select Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' },
		});
		await harness.send({
			commandId: playoutCommandId('social-profile-off-air-latest-out'),
			type: 'Out',
			payload: { graphicId: GRAPHIC_ID, cut: true },
		});
		await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'PATCH',
			body: { name: talent.name, socialProfiles: { youtube: 'LatestTake' } },
		});

		const retaken = await harness.send({
			commandId: playoutCommandId('social-profile-off-air-latest-retake'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		const projection = retaken.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(projection).toMatchObject({
			talent: { id: talent.id, name: talent.name },
			acceptedProfiles: [{ network: 'youtube', handle: 'LatestTake' }],
			currentNetwork: 'youtube',
		});
		expect(projection?.manualNetwork).toBeUndefined();
	});

	it('accepts a staged operator Talent reassignment only through explicit Update Graphic', async () => {
		const first = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Staged Source First', socialProfiles: { twitch: 'FirstSource', x: 'FirstManual' } },
		});
		const replacement = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Staged Source Replacement', socialProfiles: { youtube: 'ReplacementFirst' } },
		});
		const graphic = {
			...socialProfileGraphic('staged'),
			animation: integrationGraphicAnimation({ update: 1_000 }),
		};
		const harness = await createGraphicsHarness(eventId, 'social-profile-staged-source-update', [graphic]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', first.id);
		await harness.send({
			commandId: playoutCommandId('social-profile-staged-source-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		await harness.send({
			commandId: playoutCommandId('social-profile-staged-source-manual'),
			type: 'Select Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' },
		});
		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', replacement.id);

		const staged = await harness.reload();
		expect(staged.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			talent: { id: first.id },
			currentNetwork: 'x',
			manualNetwork: 'x',
		});
		const updated = await harness.send({
			commandId: playoutCommandId('social-profile-staged-source-update'),
			type: 'Update Graphic',
			payload: {
				graphicId: GRAPHIC_ID,
				basedOnAcceptedRevision: staged.currentState.inputs[GRAPHIC_ID]!.acceptedRevision,
			},
		});
		const projection = updated.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(projection).toMatchObject({
			talent: { id: replacement.id, name: 'Staged Source Replacement' },
			acceptedProfiles: [{ network: 'youtube', handle: 'ReplacementFirst' }],
			currentNetwork: 'youtube',
			rotationAnchor: { network: 'youtube', anchoredAt: expect.any(Number) },
		});
		expect(projection?.manualNetwork).toBeUndefined();
		expect(projection?.transitionAnchor).toBeUndefined();
		expect(updated.currentState.playout[GRAPHIC_ID]?.updateStartedAt).toEqual(expect.any(Number));
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
			automatic: true,
			rotationAnchor: { network: 'twitch', anchoredAt: expect.any(Number) },
		});

		const zero = await harness.send({
			commandId: playoutCommandId('social-profile-derived-zero'),
			type: 'Take',
			payload: { graphicId: talent2Graphic.id },
		});
		expect(zero.currentState.socialProfileProjections?.[talent2Graphic.id]?.[PROJECTION_KEY]).toEqual({
			talent: { id: talent2.id, name: 'Casey Park' },
			acceptedProfiles: [],
			automatic: true,
		});
	});

	it('re-resolves an Event Talent 1 reassignment live and discards the previous Talent manual choice', async () => {
		const first = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'First Caster', socialProfiles: { twitch: 'FirstLive', x: 'FirstCasts' } },
		});
		const replacement = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Replacement Caster', socialProfiles: { youtube: 'ReplacementLive' } },
		});
		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { commentator1TalentId: first.id },
		});
		const graphic = derivedSocialProfileGraphic('talent-1-live-profile', 'talent1', 'commentator1', 'live');
		const harness = await createGraphicsHarness(eventId, 'social-profile-derived-reassignment', [graphic]);
		await harness.send({
			commandId: playoutCommandId('social-profile-derived-reassignment-take'),
			type: 'Take',
			payload: { graphicId: graphic.id },
		});
		await harness.send({
			commandId: playoutCommandId('social-profile-derived-reassignment-select'),
			type: 'Select Social Profile',
			payload: { graphicId: graphic.id, projectionKey: PROJECTION_KEY, network: 'x' },
		});

		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { commentator1TalentId: replacement.id },
		});

		const refreshed = await harness.reload();
		const projection = refreshed.currentState.socialProfileProjections?.[graphic.id]?.[PROJECTION_KEY];
		expect(projection).toMatchObject({
			talent: { id: replacement.id, name: 'Replacement Caster' },
			acceptedProfiles: [{ network: 'youtube', handle: 'ReplacementLive' }],
			currentNetwork: 'youtube',
			transitionAnchor: { startedAt: expect.any(Number) },
			rotationAnchor: { network: 'youtube', anchoredAt: expect.any(Number) },
		});
		expect(projection?.manualNetwork).toBeUndefined();
		expect(projection!.rotationAnchor!.anchoredAt)
			.toBe(projection!.transitionAnchor!.startedAt + 250);
	});

	it('serializes a manual profile choice racing the Event Data refresh without reviving a removed profile', async () => {
		const talent = await $fetch<{ id: number; name: string }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Racing Caster', socialProfiles: { twitch: 'RaceTwitch', x: 'RaceX' } },
		});
		const harness = await createGraphicsHarness(
			eventId,
			'social-profile-event-control-race',
			[socialProfileGraphic('live')],
		);
		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-event-control-race-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		const commandUrl = `/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`;

		const [eventEdit, manualChoice] = await Promise.all([
			$fetchRaw(`/api/events/${eventId}/talents/${talent.id}`, {
				method: 'PATCH',
				body: { name: talent.name, socialProfiles: { youtube: 'RaceWinner' } },
				ignoreResponseError: true,
			}),
			$fetchRaw(commandUrl, {
				method: 'POST',
				body: {
					commandId: playoutCommandId('social-profile-event-control-race-select'),
					type: 'Select Social Profile',
					payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, network: 'x' },
				},
				ignoreResponseError: true,
			}),
		]);
		expect(eventEdit.status).toBe(200);
		expect([200, 409]).toContain(manualChoice.status);

		const authoritative = await harness.reload();
		expect(authoritative.sequence).toBeGreaterThan(taken.sequence);
		expect(authoritative.recoveryFault).toBeNull();
		const projection = authoritative.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(projection).toMatchObject({
			acceptedProfiles: [{ network: 'youtube', handle: 'RaceWinner' }],
			currentNetwork: 'youtube',
		});
		expect(projection?.manualNetwork).toBeUndefined();
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
			automatic: true,
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
			rotationAnchor: { network: 'x', anchoredAt: expect.any(Number) },
		});
	});

	it('pauses and resumes Automatic through the real route and persists its frozen anchor across reload', async () => {
		const talent = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Robin Shah',
				socialProfiles: { twitch: 'RobinLive', youtube: 'RobinCasts' },
			},
		});
		const harness = await createGraphicsHarness(eventId, 'social-profile-automatic', [socialProfileGraphic()]);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-automatic-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});
		const takenProjection = taken.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];

		const paused = await harness.send({
			commandId: playoutCommandId('social-profile-automatic-pause'),
			type: 'Set Social Profile Automatic',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, automatic: false },
		});
		const pausedProjection = paused.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(pausedProjection).toMatchObject({
			currentNetwork: 'twitch',
			automatic: false,
			rotationAnchor: { network: 'twitch', anchoredAt: expect.any(Number) },
		});
		expect(pausedProjection?.manualNetwork).toBeUndefined();
		expect(pausedProjection!.rotationAnchor!.anchoredAt)
			.toBeGreaterThanOrEqual(takenProjection!.rotationAnchor!.anchoredAt);

		const reloaded = await harness.reload();
		expect(reloaded.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY])
			.toEqual(pausedProjection);

		const resumed = await harness.send({
			commandId: playoutCommandId('social-profile-automatic-resume'),
			type: 'Set Social Profile Automatic',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY, automatic: true },
		});
		const resumedProjection = resumed.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY];
		expect(resumedProjection).toMatchObject({
			currentNetwork: 'twitch',
			automatic: true,
			rotationAnchor: { network: 'twitch', anchoredAt: expect.any(Number) },
		});
		expect(resumedProjection?.manualNetwork).toBeUndefined();
		expect(resumedProjection!.rotationAnchor!.anchoredAt)
			.toBeGreaterThanOrEqual(pausedProjection!.rotationAnchor!.anchoredAt);
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
		});
		expect((previous.currentState as typeof previous.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]?.currentNetwork).toBe('bluesky');

		const next = await harness.send({
			commandId: playoutCommandId('social-profile-next'),
			type: 'Next Social Profile',
			payload: { graphicId: GRAPHIC_ID, projectionKey: PROJECTION_KEY },
		});
		expect((next.currentState as typeof next.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string; manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'twitch',
			manualNetwork: 'twitch',
			rotationAnchor: { network: 'twitch', anchoredAt: expect.any(Number) },
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
		});
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
		});
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
			automatic: true,
			rotationAnchor: { network: 'x', anchoredAt: expect.any(Number) },
		});

		const reloaded = await harness.reload();
		expect((reloaded.currentState as typeof reloaded.currentState & {
			socialProfileProjections: Record<string, Record<string, { currentNetwork?: string; manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			currentNetwork: 'x',
			manualNetwork: 'x',
			automatic: true,
			rotationAnchor: { network: 'x', anchoredAt: expect.any(Number) },
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
			automatic: true,
			rotationAnchor: { network: 'twitch', anchoredAt: expect.any(Number) },
		});
		expect((afterReset.currentState as typeof afterReset.currentState & {
			socialProfileProjections: Record<string, Record<string, { manualNetwork?: string }>>;
		}).socialProfileProjections[GRAPHIC_ID]?.[PROJECTION_KEY]?.manualNetwork).toBeUndefined();
	});
});
