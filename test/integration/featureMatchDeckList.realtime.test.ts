import type { InboundMessage } from 'ably';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch } from './client';
import { INTEGRATION_ABLY_API_KEY, integrationRealtimeConfigured } from './realtimeKey';

// A Feature Match Deck List pasted on a One Piece Slot side (ADR-0057): a
// replacement during a Session reaches its snapshot and its followers.
// bandai-keepr is `./mock-bandai-keepr.mjs`.

const ZORO_DECK = '1x OP01-001 Roronoa Zoro\n4x OP01-025\n2x OP99-999';
const NAMI_DECK = '1x OP01-016 Nami\n4x OP01-040';

describe('a Feature Match Slot side\'s Deck List', () => {
	let eventId: number;
	let slotId: number;
	let sessionId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration One Piece Deck Lists', game: 'op', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: {
				player1Data: { name: 'Ana' },
				player2Data: { name: 'Ben' },
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

	async function paste(text: string) {
		return await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/deck-lists`, {
			method: 'POST',
			body: { side: 'player1', text },
		}) as any;
	}

	it('previews a paste with number-only placeholders, storing nothing', async () => {
		const answer = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/deck-lists/preview`, {
			method: 'POST',
			body: { text: ZORO_DECK },
		}) as any;

		expect(answer.deckList.entries.map((entry: any) => [entry.number, entry.card?.name ?? null])).toEqual([
			['OP01-001', 'Roronoa Zoro'],
			['OP01-025', 'Roronoa Zoro'],
			['OP99-999', null],
		]);
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`);
		expect(slot.player1Data?.gameData ?? null).toBeNull();
	});

	it('reaches the active Session\'s snapshot when replaced, without reopening it', async () => {
		await paste(ZORO_DECK);
		const replaced = await paste(NAMI_DECK);

		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`);
		expect(slot.activeSession!.id).toBe(sessionId);
		expect(slot.activeSession!.sourceSnapshot.player1.data!.gameData).toMatchObject({
			type: 'op',
			leader: { number: 'OP01-016', name: 'Nami' },
			featureMatchDeckList: { id: replaced.deckList.id, mainboardCount: 4 },
		});
		const read = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/deck-lists/${replaced.deckList.id}`) as any;
		expect(read.sourceText).toBe(NAMI_DECK);
	});

	// The Slot's own announcement carries its corrected Session; the correction announces nothing itself.
	it.skipIf(!integrationRealtimeConfigured)('announces a replacement with the Slot and its corrected Session', async () => {
		const realtime = new Ably.Realtime(INTEGRATION_ABLY_API_KEY);
		const channel = realtime.channels.get(eventRealtimeChannel(eventId));
		let resolveMessage!: (message: InboundMessage) => void;
		const announced = new Promise<InboundMessage>((resolve) => {
			resolveMessage = resolve;
		});
		const listener = (message: InboundMessage) => {
			if (JSON.stringify(message.data).includes('"mainboardCount":6'))
				resolveMessage(message);
		};
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await channel.subscribe('featureMatch:updated', listener);
			const replaced = await paste(ZORO_DECK);

			const message = await Promise.race([
				announced,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Timed out waiting for the Deck List announcement')), 10_000);
				}),
			]);

			const reference = { id: replaced.deckList.id, mainboardCount: 6 };
			const { featureMatch } = message.data;
			expect(featureMatch.player1Data.gameData).toMatchObject({
				leader: { number: 'OP01-001' },
				featureMatchDeckList: reference,
			});
			expect(featureMatch.activeSession).toMatchObject({
				id: sessionId,
				sourceSnapshot: {
					player1: {
						data: {
							gameData: { featureMatchDeckList: reference },
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
