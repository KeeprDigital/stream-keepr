import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createGraphicsHarness,
	playoutCommandId,
	selectBroadcastGraphicSource,
} from './broadcastGraphicsPlayoutHelpers';
import { $fetch } from './client';

/*
 * One wiring pass per route that reaches a Social Profile Projection: the command
 * route, a Talent write and an Event write. What each does to the Live Session is
 * proved over real SQL in
 * `test/unit/server/modules/socialProfileLiveRefresh.sqlite.test.ts`, and the
 * rotation rules in `test/unit/shared/socialProfile*.test.ts`.
 */

const GRAPHIC_ID = 'talent-lower-third';
const PROJECTION_KEY = 'profile';
const TRANSITION_DURATION_MS = 250;

function socialProfileGraphic(updatePolicy?: 'staged' | 'live'): BroadcastGraphicConfig {
	const square = { treatment: 'square' as const, size: 0 };
	const projection = {
		key: PROJECTION_KEY,
		label: 'Social Profile',
		sourceKey: 'talent',
		presentationGroupId: 'profile-group',
		dwellMs: 8_000,
		transition: 'crossfade' as const,
		transitionDurationMs: TRANSITION_DURATION_MS,
		...(updatePolicy
			? { updatePolicy }
			: {}),
	};

	return {
		id: GRAPHIC_ID,
		name: 'Talent lower third',
		sources: [
			{ key: 'talent', label: 'Talent', kind: 'talent' },
		],
		socialProfileProjections: [projection],
		items: [
			{
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
			},
		],
	};
}

/** The same graphic, its Talent derived from the Event's Talent 1. */
function eventTalentSocialProfileGraphic(graphicId: string): BroadcastGraphicConfig {
	const graphic = socialProfileGraphic('live');
	return {
		...graphic,
		id: graphicId,
		sources: [
			{ key: 'event', label: 'Event', kind: 'event' },
			{
				key: 'talent1',
				label: 'Talent 1',
				kind: 'talent',
				from: { sourceKey: 'event', relation: 'commentator1' },
			},
		],
		socialProfileProjections: graphic.socialProfileProjections?.map(projection => ({
			...projection,
			sourceKey: 'talent1',
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
		const harness = await createGraphicsHarness(eventId, 'social-profile-take', [
			socialProfileGraphic(),
		]);

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
			rotationAnchor: {
				network: 'twitch',
				anchoredAt: expect.any(Number),
			},
		});
	});

	it('applies a Talent profile edit to a live-policy projection on air', async () => {
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
			[
				socialProfileGraphic('live'),
			],
		);

		await selectBroadcastGraphicSource(harness, GRAPHIC_ID, 'talent', talent.id);
		const taken = await harness.send({
			commandId: playoutCommandId('social-profile-live-reresolution-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC_ID },
		});

		await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'PATCH',
			body: {
				name: talent.name,
				socialProfiles: { twitch: 'AfterLive', youtube: 'NewlyAdded' },
			},
		});

		const refreshed = await harness.reload();
		expect(refreshed.sequence).toBeGreaterThan(taken.sequence);
		expect(refreshed.currentState.socialProfileProjections?.[GRAPHIC_ID]?.[PROJECTION_KEY]).toMatchObject({
			acceptedProfiles: [
				{ network: 'twitch', handle: 'AfterLive' },
				{ network: 'youtube', handle: 'NewlyAdded' },
			],
			currentNetwork: 'twitch',
		});
	});

	it('re-resolves an Event Talent 1 reassignment live', async () => {
		const first = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'First Caster',
				socialProfiles: { twitch: 'FirstLive' },
			},
		});
		const replacement = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: {
				name: 'Replacement Caster',
				socialProfiles: { youtube: 'ReplacementLive' },
			},
		});
		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { commentator1TalentId: first.id },
		});
		const graphic = eventTalentSocialProfileGraphic('talent-1-live-profile');
		const harness = await createGraphicsHarness(eventId, 'social-profile-derived-reassignment', [graphic]);
		await harness.send({
			commandId: playoutCommandId('social-profile-derived-reassignment-take'),
			type: 'Take',
			payload: { graphicId: graphic.id },
		});

		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { commentator1TalentId: replacement.id },
		});

		const refreshed = await harness.reload();
		expect(refreshed.currentState.socialProfileProjections?.[graphic.id]?.[PROJECTION_KEY]).toMatchObject({
			talent: { id: replacement.id, name: 'Replacement Caster' },
			acceptedProfiles: [
				{ network: 'youtube', handle: 'ReplacementLive' },
			],
			currentNetwork: 'youtube',
		});
	});
});
