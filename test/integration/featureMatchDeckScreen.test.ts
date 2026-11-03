import type { InboundMessage } from 'ably';
import type { ScreenResponse } from '~~/shared/api';
import type { ScreenOutputFeatureMatchDeckListResponse, ScreenOutputFeatureMatchResponse } from '~~/shared/types/screenOutputReads';
import Ably from 'ably';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch, anonymousFetch } from './client';
import { commandId, getFeatureMatchSlot, requireActiveSession, sendFeatureMatchCommand } from './featureMatchSessionHelpers';
import { INTEGRATION_ABLY_API_KEY, integrationRealtimeConfigured } from './helpers';

// A Deck Screen showing an OP Slot side reads its Deck List by capability alone,
// follows the player the Session seats there (ADR-0058), and is released when
// its Slot is deleted (ADR-0057). bandai-keepr is `./mock-bandai-keepr.mjs`.

const ZORO_DECK = '1x OP01-001 Roronoa Zoro\n4x OP01-025';
const NAMI_DECK = '1x OP01-016 Nami\n4x OP01-040';

describe('a Deck Screen showing a Feature Match Slot side', () => {
	let eventId: number;
	let slotId: number;
	let sessionId: number;
	let screen: ScreenResponse;
	let capability: string;

	async function paste(side: 'player1' | 'player2', text: string): Promise<number> {
		const answer = await $fetch<{ deckList: { id: number } }>(`/api/events/${eventId}/feature-match-slots/${slotId}/deck-lists`, {
			method: 'POST',
			body: { side, text },
		});
		return answer.deckList.id;
	}

	async function asOutput<T>(resource: string): Promise<{ status: number; data: T }> {
		const response = await anonymousFetch(`/api/screen-output/events/${eventId}/screens/${screen.id}/${resource}`, {
			headers: { authorization: `Bearer ${capability}` },
		});
		const text = await response.text();
		return {
			status: response.status,
			data: (text
				? JSON.parse(text)
				: null) as T,
		};
	}

	/** The Deck List the shown side's player holds, as the output resolves it from the Slot read. */
	async function shownDeckListId(side: 'player1' | 'player2'): Promise<number | null> {
		const { data } = await asOutput<ScreenOutputFeatureMatchResponse>(`feature-match-slots/${slotId}`);
		const gameData = data.slot.activeSession!.sourceSnapshot[side]!.data!.gameData as { featureMatchDeckList?: { id: number } | null };
		return gameData.featureMatchDeckList?.id ?? null;
	}

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration One Piece Deck Screen', game: 'op', featureMatchOrientation: 'horizontal' },
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
		sessionId = requireActiveSession(slot as never).id;

		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Deck', slug: `op-deck-screen-${eventId}`, currentMode: 'deck' },
		});
		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}/config/deck`, {
			method: 'PATCH',
			body: {
				deckSource: { type: 'featureMatchSlot', slotId, side: 'player1' },
			},
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

	it('reads the side\'s Deck List, then the other player\'s after Swap Players, with its capability alone', async () => {
		const anaDeckListId = await paste('player1', ZORO_DECK);
		const benDeckListId = await paste('player2', NAMI_DECK);

		expect(await shownDeckListId('player1')).toBe(anaDeckListId);
		const ana = await asOutput<ScreenOutputFeatureMatchDeckListResponse>(`feature-match-slots/${slotId}/deck-lists/${anaDeckListId}`);
		expect(ana.status).toBe(200);
		expect(ana.data.entries.map(entry => [entry.number, entry.quantity])).toEqual([
			['OP01-001', 1],
			['OP01-025', 4],
		]);

		const held = await getFeatureMatchSlot(eventId, slotId);
		await sendFeatureMatchCommand(eventId, sessionId, {
			commandId: commandId('deck-screen-swap'),
			type: 'SwapPlayers',
			payload: {},
			baseSequence: requireActiveSession(held).sequence,
		});

		expect(await shownDeckListId('player1')).toBe(benDeckListId);
		const ben = await asOutput<ScreenOutputFeatureMatchDeckListResponse>(`feature-match-slots/${slotId}/deck-lists/${benDeckListId}`);
		expect(ben.data.leaderNumber).toBe('OP01-016');
	});

	it('reads a re-pasted Deck List, and no longer the one it replaced', async () => {
		const before = await paste('player1', ZORO_DECK);
		const after = await paste('player1', NAMI_DECK);

		expect((await asOutput(`feature-match-slots/${slotId}/deck-lists/${after}`)).status).toBe(200);
		expect((await asOutput(`feature-match-slots/${slotId}/deck-lists/${before}`)).status).toBe(404);
	});

	// The delete clears the Screen's Deck Source in its own write, and announces the Screen.
	it.skipIf(!integrationRealtimeConfigured)('is released and announced when its Slot is deleted', async () => {
		const realtime = new Ably.Realtime(INTEGRATION_ABLY_API_KEY);
		const channel = realtime.channels.get(eventRealtimeChannel(eventId));
		let resolveMessage!: (message: InboundMessage) => void;
		const announced = new Promise<InboundMessage>((resolve) => {
			resolveMessage = resolve;
		});
		const listener = (message: InboundMessage) => {
			if (message.data?.screenId === screen.id)
				resolveMessage(message);
		};
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			const before = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}`);
			await channel.subscribe('screen:updated', listener);
			await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`, { method: 'DELETE' });

			await Promise.race([
				announced,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error('Timed out waiting for the Screen announcement')), 10_000);
				}),
			]);

			const released = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}`);
			expect(released.modeConfigs?.deck?.deckSource).toEqual({ type: 'featureMatchSlot', slotId: null, side: 'player1' });
			expect(released.stateVersion).toBe(before.stateVersion + 1);
			expect((await asOutput(`feature-match-slots/${slotId}`)).status).toBe(404);
		}
		finally {
			if (timeout)
				clearTimeout(timeout);
			channel.unsubscribe(listener);
			realtime.close();
		}
	});
});
