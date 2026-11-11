import type { InboundMessage } from 'ably';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { LAW, NAMI, ZORO } from '../helpers/opCards';
import { $fetch } from './client';
import { INTEGRATION_ABLY_API_KEY, integrationRealtimeConfigured } from './realtimeKey';

// A Slot side's Leader on a One Piece Event (ADR-0057): a change during a
// Feature Match Session reaches its snapshot and its followers.

function side(name: string, sideLeader: unknown) {
	return {
		name,
		gameData: { type: 'op', leader: sideLeader },
	};
}

describe('a Feature Match Slot side\'s Leader', () => {
	let eventId: number;
	let slotId: number;
	let sessionId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration One Piece Leaders', game: 'op', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {
				player1Data: side('Ana', ZORO),
				player2Data: side('Ben', LAW),
			},
		});
		slotId = slot.id;
		const session = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/sessions`, { method: 'POST' });
		sessionId = session.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	async function changeLeader(sideLeader: unknown) {
		return await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: side('Ana', sideLeader),
			},
		});
	}

	it('reaches the active Session\'s snapshot without reopening it', async () => {
		await changeLeader(NAMI);

		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`);
		expect(slot.activeSession!.id).toBe(sessionId);
		expect(slot.activeSession!.sourceSnapshot.player1.data!.gameData).toEqual({ type: 'op', leader: NAMI });
		expect(slot.activeSession!.sourceSnapshot.player2.data!.gameData).toEqual({ type: 'op', leader: LAW });
	});

	// The Slot's own announcement carries its corrected Session; the correction announces nothing itself.
	it.skipIf(!integrationRealtimeConfigured)('announces the change with the Slot and its corrected Session', async () => {
		const realtime = new Ably.Realtime(INTEGRATION_ABLY_API_KEY);
		const channel = realtime.channels.get(eventRealtimeChannel(eventId));
		let resolveMessage!: (message: InboundMessage) => void;
		const announced = new Promise<InboundMessage>((resolve) => {
			resolveMessage = resolve;
		});
		const listener = (message: InboundMessage) => {
			if (JSON.stringify(message.data).includes('Roronoa Zoro'))
				resolveMessage(message);
		};
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await channel.subscribe('featureMatch:updated', listener);
			await changeLeader(ZORO);

			const message = await Promise.race([
				announced,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Timed out waiting for the Leader announcement')), 10_000);
				}),
			]);

			const { featureMatch } = message.data;
			expect(featureMatch.player1Data.gameData).toEqual({ type: 'op', leader: ZORO });
			expect(featureMatch.activeSession).toMatchObject({
				id: sessionId,
				sourceSnapshot: {
					player1: {
						data: {
							gameData: { type: 'op', leader: ZORO },
						},
					},
				},
			});
		}
		finally {
			if (timeout)
				clearTimeout(timeout);
			channel.unsubscribe(listener);
			realtime.close();
		}
	});
});
