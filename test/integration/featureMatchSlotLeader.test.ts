import type { InboundMessage } from 'ably';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch } from './client';
import { $fetchRaw, INTEGRATION_ABLY_API_KEY, integrationRealtimeConfigured } from './helpers';

// A Slot side's Leader on a One Piece Event (ADR-0057): a change during a
// Feature Match Session reaches its snapshot, its followers and the public read.

function leader(number: string, name: string, colors: string[]) {
	return {
		number,
		name,
		colors,
		imageUrl: `https://cards-img.keepr.digital/${number}.png`,
	};
}
const zoro = leader('OP01-001', 'Roronoa Zoro', ['Red']);
const nami = leader('OP01-016', 'Nami', ['Blue']);
const law = leader('OP01-002', 'Trafalgar Law', ['Red', 'Green']);
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
				player1Data: side('Ana', zoro),
				player2Data: side('Ben', law),
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
		await changeLeader(nami);

		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`);
		expect(slot.activeSession!.id).toBe(sessionId);
		expect(slot.activeSession!.sourceSnapshot.player1.data!.gameData).toEqual({ type: 'op', leader: nami });
		expect(slot.activeSession!.sourceSnapshot.player2.data!.gameData).toEqual({ type: 'op', leader: law });
	});

	it('shows on the public read where a Magic deck would', async () => {
		await changeLeader(nami);

		const [row] = await $fetch(`/api/public/events/${eventId}/feature-match-slots/${slotId}`) as Record<string, string>[];
		expect(row).toMatchObject({
			player1Deck: 'Nami',
			player1DeckColors: 'Blue',
			player1LeaderImage: 'https://cards-img.keepr.digital/OP01-016.png',
			player2Deck: 'Trafalgar Law',
			player2DeckColors: 'Red/Green',
		});
	});

	it('refuses a Leader whose image is not a One Piece card image', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: side('Ana', { ...nami, imageUrl: 'https://example.com/nami.png' }),
			},
		});

		expect(res.status).toBe(400);
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
			await changeLeader(zoro);

			const message = await Promise.race([
				announced,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Timed out waiting for the Leader announcement')), 10_000);
				}),
			]);

			const { featureMatch } = message.data;
			expect(featureMatch.player1Data.gameData).toEqual({ type: 'op', leader: zoro });
			expect(featureMatch.activeSession).toMatchObject({
				id: sessionId,
				sourceSnapshot: {
					player1: {
						data: {
							gameData: { type: 'op', leader: zoro },
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
