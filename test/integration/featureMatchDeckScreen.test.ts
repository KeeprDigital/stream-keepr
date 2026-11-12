import type { ScreenResponse } from '~~/shared/api';
import type { ScreenOutputFeatureMatchDeckListResponse, ScreenOutputFeatureMatchResponse } from '~~/shared/types/screenOutputReads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch, anonymousFetch } from './client';
import { commandId, getFeatureMatchSlot, requireActiveSession, sendFeatureMatchCommand } from './featureMatchSessionHelpers';

// A Deck List Screen showing an OP Slot side reads its Deck List by
// capability alone, and follows the player the Session seats there (ADR-0058).
// Its release when its Slot is deleted is in `featureMatchDeckScreen.realtime.test.ts`.
// bandai-keepr is `./mock-bandai-keepr.mjs`.

const ZORO_DECK = '1x OP01-001 Roronoa Zoro\n4x OP01-025';
const NAMI_DECK = '1x OP01-016 Nami\n4x OP01-040';

describe('a Deck List Screen showing a Feature Match Slot side', () => {
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
			body: { name: 'Integration One Piece Deck List Screen', game: 'op', featureMatchOrientation: 'horizontal' },
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
});
