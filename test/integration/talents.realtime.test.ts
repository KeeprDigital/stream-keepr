import type { InboundMessage } from 'ably';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { LOAD_TOLERANT_WAIT_MS } from '../helpers/loadTolerantBounds';
import { $fetch } from './client';
import { INTEGRATION_ABLY_API_KEY, integrationRealtimeConfigured } from './realtimeKey';

// What the Talent routes publish. The routes themselves are in `talents.test.ts`, which needs no Ably key.

describe('talents API announcements', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Talent Announcements Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it.skipIf(!integrationRealtimeConfigured)('publishes normalized complete Social Profile maps from the Talent routes', async () => {
		const realtime = new Ably.Realtime(INTEGRATION_ABLY_API_KEY);
		const channel = realtime.channels.get(eventRealtimeChannel(eventId));
		const heard: InboundMessage[] = [];
		const waiting = new Set<() => void>();
		const listener = (message: InboundMessage) => {
			heard.push(message);
			for (const check of waiting)
				check();
		};

		/**
		 * The named message about this Talent, whether it arrived before the
		 * request answered or arrives after: each write's message is awaited by
		 * what it says, so nothing rests on how many arrive or in which order.
		 */
		async function announced(name: string, talentId: number): Promise<InboundMessage> {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			let check: (() => void) | undefined;
			try {
				return await new Promise<InboundMessage>((resolve, reject) => {
					check = () => {
						const message = heard.find(candidate => candidate.name === name && candidate.data?.talent?.id === talentId);
						if (message)
							resolve(message);
					};
					waiting.add(check);
					timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), LOAD_TOLERANT_WAIT_MS);
					check();
				});
			}
			finally {
				if (timeout)
					clearTimeout(timeout);
				if (check)
					waiting.delete(check);
			}
		}

		try {
			await channel.subscribe(['talent:created', 'talent:updated'], listener);
			const created = await $fetch(`/api/events/${eventId}/talents`, {
				method: 'POST',
				body: {
					name: 'Realtime Route Caster',
					socialProfiles: {
						twitch: 'https://twitch.tv/@RouteCaster',
						youtube: 'https://youtube.com/@RouteCasts',
					},
				},
			});
			expect((await announced('talent:created', created.id)).data).toMatchObject({
				eventId,
				talent: {
					id: created.id,
					name: 'Realtime Route Caster',
					socialProfiles: { twitch: 'RouteCaster', youtube: 'RouteCasts' },
				},
			});

			await $fetch(`/api/events/${eventId}/talents/${created.id}`, {
				method: 'PATCH',
				body: {
					socialProfiles: {
						x: 'https://x.com/@RouteCaster',
						bluesky: 'https://bsky.app/profile/@RouteCaster.bsky.social',
					},
				},
			});
			expect((await announced('talent:updated', created.id)).data).toMatchObject({
				eventId,
				talent: {
					id: created.id,
					name: 'Realtime Route Caster',
					socialProfiles: { x: 'RouteCaster', bluesky: 'RouteCaster.bsky.social' },
				},
			});
		}
		finally {
			channel.unsubscribe(listener);
			realtime.close();
		}
	});
});
