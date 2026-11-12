import type { InboundMessage } from 'ably';
import type { ScreenResponse } from '~~/shared/api';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screenRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { LOAD_TOLERANT_WAIT_MS } from '../helpers/loadTolerantBounds';
import { $fetch, anonymousFetch } from './client';
import { integrationRealtimeConfigured } from './realtimeKey';

/**
 * A Screen Output hears on its own Screen channel, holding only its Screen
 * Output Asset Capability, that what its mode shows changed (#604). The reads it
 * then makes are in `screenOutputReads.test.ts`, which needs no Ably key.
 */
describe('a capability-only Screen Output on its Screen channel', () => {
	let eventId: number;
	let screen: ScreenResponse;
	let capability: string;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Screen Output Channel Event', game: 'mtg', featureMatchOrientation: 'vertical' },
		});
		eventId = event.id;

		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Output standings', slug: `output-channel-standings-${eventId}`, currentMode: 'standings' },
		});
		capability = (await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screen.id}/asset-capability`,
		)).assetCapability;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// The Screen's own channel names what its mode shows changed; the output re-reads it through its Screen.
	it.skipIf(!integrationRealtimeConfigured)('is told on its own channel that its mode\'s data changed', async () => {
		const realtime = new Ably.Realtime({
			authCallback: (_params, callback) => {
				anonymousFetch(`/api/realtime/token?eventId=${eventId}`, {
					headers: { authorization: `Bearer ${capability}` },
				})
					.then(async response => callback(null, await response.json()), error => callback(error, null));
			},
		});
		const channel = realtime.channels.get(screenRealtimeChannel(eventId, screen.id));
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			let told!: (message: InboundMessage) => void;
			const heard = new Promise<InboundMessage>((resolve) => {
				told = resolve;
			});
			await channel.subscribe('output:modeDataChanged', told);

			await $fetch(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'Heard On The Screen Channel' },
			});

			const message = await Promise.race([
				heard,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Timed out waiting for output:modeDataChanged')), LOAD_TOLERANT_WAIT_MS);
				}),
			]);
			expect(message.data).toMatchObject({
				eventId,
				screenId: screen.id,
				causes: ['player'],
			});
		}
		finally {
			if (timeout)
				clearTimeout(timeout);
			realtime.close();
		}
	});
});
