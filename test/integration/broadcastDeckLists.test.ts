import type { InboundMessage } from 'ably';
import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastDeckListResponse } from '~~/shared/types/broadcastDeckList';
import Ably from 'ably';
import { describe, expect, it } from 'vitest';
import { eventRealtimeChannel } from '../../shared/utils/realtimeChannels';
import { $fetch, anonymousFetch, fetch } from './client';
import { INTEGRATION_ABLY_API_KEY } from './helpers';
import { queryIntegrationD1 } from './integrationD1';

const initialSource = '1 Integration Bolt (it1) 1';
const authoredSource = [
	'Mainboard',
	'4 Integration Bolt (it1) 1',
	'Sideboard',
	'2 Integration Blast (it1) 2',
	'Companion',
	'1 Integration Companion (it1) 3',
].join('\n');
const newerSource = authoredSource.replace('4 Integration Bolt', '5 Integration Bolt');

interface JsonResponse {
	status: number;
	data: unknown;
}

async function readJson(response: Response): Promise<JsonResponse> {
	const text = await response.text();
	return { status: response.status, data: text ? JSON.parse(text) as unknown : null };
}

async function signedJson(path: string, method: string, body: unknown): Promise<JsonResponse> {
	return await readJson(await fetch(path, {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	}));
}

async function anonymousJson(
	path: string,
	init: RequestInit = {},
): Promise<JsonResponse> {
	return await readJson(await anonymousFetch(path, init));
}

function bearer(capability: string): HeadersInit {
	return { authorization: `Bearer ${capability}` };
}

describe('broadcast Deck List merged-result acceptance', () => {
	it('proves the complete resource, Screen source, authority, guard, security, and cascade workflow', async () => {
		let eventId: number | undefined;
		let otherEventId: number | undefined;
		let realtime: Ably.Realtime | undefined;

		try {
			const event = await $fetch('/api/events', {
				method: 'POST',
				body: {
					name: 'Broadcast Deck List acceptance',
					game: 'mtg',
					featureMatchOrientation: 'horizontal',
				},
			});
			eventId = event.id;
			expect(event.broadcastDeckListsEnabled).toBe(false);

			const created = await $fetch<BroadcastDeckListResponse>(
				`/api/events/${eventId}/broadcast-deck-lists`,
				{
					method: 'POST',
					body: { name: 'Feature Table', sourceText: initialSource },
				},
			);
			const reserve = await $fetch<BroadcastDeckListResponse>(
				`/api/events/${eventId}/broadcast-deck-lists`,
				{
					method: 'POST',
					body: { name: 'Reserve Table', sourceText: initialSource },
				},
			);

			const authored = await $fetch<BroadcastDeckListResponse>(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
				{
					method: 'PATCH',
					body: {
						expectedRevision: 1,
						sourceText: authoredSource,
						archetypeLabel: 'Jeskai Test',
						colors: 'UW',
					},
				},
			);
			expect(authored).toMatchObject({
				revision: 2,
				archetypeLabel: 'Jeskai Test',
				colors: 'WU',
				mainboardQuantity: 4,
				sideboardQuantity: 2,
				hasCompanion: true,
				sourceText: authoredSource,
			});
			expect(authored.entries.map(entry => ({
				compartment: entry.compartment,
				name: entry.canonicalName,
				printing: `${entry.setCode}/${entry.collectorNumber}`,
				scryfallId: entry.scryfallId,
			}))).toEqual([
				{ compartment: 'mainboard', name: 'Integration Bolt', printing: 'it1/1', scryfallId: 'integration-bolt-printing' },
				{ compartment: 'sideboard', name: 'Integration Blast', printing: 'it1/2', scryfallId: 'integration-blast-printing' },
				{ compartment: 'companion', name: 'Integration Companion', printing: 'it1/3', scryfallId: 'integration-companion-printing' },
			]);
			expect(authored.entries[0]).not.toHaveProperty('imageData');
			expect(authored.entries[0]).not.toHaveProperty('image_uris');

			const invalid = await signedJson(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
				'PATCH',
				{ expectedRevision: 2, sourceText: 'this is not a card row' },
			);
			expect(invalid).toMatchObject({
				status: 422,
				data: { data: { code: 'BROADCAST_DECK_LIST_INVALID' } },
			});

			const providerFailure = await signedJson(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
				'PATCH',
				{ expectedRevision: 2, sourceText: '1 Integration Provider Failure' },
			);
			expect(providerFailure).toMatchObject({
				status: 503,
				data: {
					message: 'Card data provider is temporarily unavailable. Try again later.',
					data: { code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true },
				},
			});

			const preserved = await $fetch<BroadcastDeckListResponse>(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
			);
			expect(preserved).toMatchObject({
				revision: 2,
				sourceText: authoredSource,
				mainboardQuantity: 4,
				sideboardQuantity: 2,
			});
			expect(preserved.entries.map(entry => entry.scryfallId)).toEqual(
				authored.entries.map(entry => entry.scryfallId),
			);

			await $fetch(`/api/events/${eventId}`, {
				method: 'PATCH',
				body: { broadcastDeckListsEnabled: true },
			});

			const programme = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
				method: 'POST',
				body: { name: 'Programme', slug: `broadcast-programme-${eventId}`, currentMode: 'deck' },
			});
			const offMode = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
				method: 'POST',
				body: { name: 'Off-mode Retainer', slug: `broadcast-retainer-${eventId}`, currentMode: 'background' },
			});

			for (const screen of [programme, offMode]) {
				const migrated = await $fetch<ScreenResponse>(
					`/api/events/${eventId}/screens/${screen.id}/config/deck`,
					{
						method: 'PATCH',
						body: {
							playerId: null,
							board: 'sideboard',
							showDeckName: false,
							showHighlanderPoints: false,
							quantityPosition: 'bottom-right',
						},
					},
				);
				expect(migrated.modeConfigs?.deck).toMatchObject({
					deckSource: { type: 'player', playerId: null },
					board: 'sideboard',
					showDeckName: false,
					showHighlanderPoints: false,
					quantityPosition: 'bottom-right',
				});
				expect(migrated.modeConfigs?.deck).not.toHaveProperty('playerId');

				const selected = await $fetch<ScreenResponse>(
					`/api/events/${eventId}/screens/${screen.id}/config/deck`,
					{
						method: 'PATCH',
						body: { deckSource: { type: 'broadcast', broadcastDeckListId: created.id } },
					},
				);
				expect(selected.modeConfigs?.deck).toMatchObject({
					deckSource: { type: 'broadcast', broadcastDeckListId: created.id },
					board: 'sideboard',
					showDeckName: false,
					showHighlanderPoints: false,
					quantityPosition: 'bottom-right',
				});
			}

			const outputPath = `/api/screen-output/events/${eventId}/screens/${programme.id}/broadcast-deck-list`;
			const programmeCapability = await $fetch<{ assetCapability: string }>(
				`/api/events/${eventId}/screens/${programme.id}/asset-capability`,
			);
			const sessionRead = await $fetch<BroadcastDeckListResponse>(outputPath);
			const capabilityRead = await anonymousJson(outputPath, {
				headers: bearer(programmeCapability.assetCapability),
			});
			expect(sessionRead).toMatchObject({ id: created.id, revision: 2 });
			expect(capabilityRead).toMatchObject({
				status: 200,
				data: { id: created.id, revision: 2, sourceText: authoredSource },
			});
			expect((capabilityRead.data as { id: number }).id).not.toBe(reserve.id);

			otherEventId = (await $fetch('/api/events', {
				method: 'POST',
				body: { name: 'Other Broadcast Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
			})).id;
			await $fetch(`/api/events/${otherEventId}`, {
				method: 'PATCH',
				body: { broadcastDeckListsEnabled: true },
			});
			const otherScreen = await $fetch<ScreenResponse>(`/api/events/${otherEventId}/screens`, {
				method: 'POST',
				body: { name: 'Other Screen', slug: `other-broadcast-${otherEventId}`, currentMode: 'deck' },
			});
			const otherCapability = await $fetch<{ assetCapability: string }>(
				`/api/events/${otherEventId}/screens/${otherScreen.id}/asset-capability`,
			);

			const crossEventRead = await signedJson(
				`/api/events/${otherEventId}/broadcast-deck-lists/${created.id}`,
				'GET',
				undefined,
			);
			const crossEventSelect = await signedJson(
				`/api/events/${otherEventId}/screens/${otherScreen.id}/config/deck`,
				'PATCH',
				{ deckSource: { type: 'broadcast', broadcastDeckListId: created.id } },
			);
			expect(crossEventRead.status).toBe(404);
			expect(crossEventSelect.status).toBe(409);

			const anonymousRead = await anonymousJson(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
			);
			const anonymousSelect = await anonymousJson(
				`/api/events/${eventId}/screens/${programme.id}/config/deck`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ deckSource: { type: 'broadcast', broadcastDeckListId: created.id } }),
				},
			);
			const wrongCapabilityRead = await anonymousJson(outputPath, {
				headers: bearer(otherCapability.assetCapability),
			});
			const capabilitySelect = await anonymousJson(
				`/api/events/${eventId}/screens/${programme.id}/config/deck`,
				{
					method: 'PATCH',
					headers: {
						...bearer(otherCapability.assetCapability),
						'content-type': 'application/json',
					},
					body: JSON.stringify({ deckSource: { type: 'broadcast', broadcastDeckListId: created.id } }),
				},
			);
			expect(anonymousRead.status).toBe(401);
			expect(anonymousSelect.status).toBe(401);
			expect(wrongCapabilityRead.status).toBe(404);
			expect(capabilitySelect.status).toBe(401);

			realtime = new Ably.Realtime(INTEGRATION_ABLY_API_KEY);
			const channel = realtime.channels.get(eventRealtimeChannel(eventId));
			let resolveUpdate!: (message: InboundMessage) => void;
			const updateNotice = new Promise<InboundMessage>((resolve) => {
				resolveUpdate = resolve;
			});
			const listener = (message: InboundMessage) => resolveUpdate(message);
			await channel.subscribe('broadcastDeckList:updated', listener);

			const updateRequest = $fetch<BroadcastDeckListResponse>(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
				{
					method: 'PATCH',
					body: { expectedRevision: 2, name: 'Feature Table Updated', sourceText: newerSource },
				},
			);
			const concurrentOutputRead = $fetch<BroadcastDeckListResponse>(outputPath);
			const [updated, duringUpdate] = await Promise.all([updateRequest, concurrentOutputRead]);
			const notice = await Promise.race([
				updateNotice,
				new Promise<never>((_resolve, reject) => {
					setTimeout(() => reject(new Error('Timed out waiting for Broadcast Deck List update notification')), 10_000);
				}),
			]);
			channel.unsubscribe(listener);

			expect(updated).toMatchObject({ revision: 3, name: 'Feature Table Updated', sourceText: newerSource });
			expect([2, 3]).toContain(duringUpdate.revision);
			expect(duringUpdate.entries.length).toBeGreaterThan(0);
			expect(notice.name).toBe('broadcastDeckList:updated');
			expect(notice.data).toMatchObject({ eventId, listId: created.id, revision: 3 });
			expect(notice.data).not.toHaveProperty('sourceText');
			expect(notice.data).not.toHaveProperty('entries');

			const collection = await $fetch<{ broadcastDeckLists: Array<{ id: number; revision: number; name: string }> }>(
				`/api/events/${eventId}/broadcast-deck-lists`,
			);
			expect(collection.broadcastDeckLists.find(list => list.id === created.id)).toEqual(
				expect.objectContaining({ revision: 3, name: 'Feature Table Updated' }),
			);
			const authoritativeOutput = await $fetch<BroadcastDeckListResponse>(outputPath);
			expect(authoritativeOutput).toMatchObject({ revision: 3, name: 'Feature Table Updated', sourceText: newerSource });
			expect(authoritativeOutput.entries.length).toBeGreaterThan(0);

			const stale = await signedJson(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
				'PATCH',
				{ expectedRevision: 2, name: 'Stale overwrite' },
			);
			expect(stale).toMatchObject({
				status: 409,
				data: { data: { code: 'BROADCAST_DECK_LIST_REVISION_CONFLICT', current: { revision: 3 } } },
			});
			expect(await $fetch<BroadcastDeckListResponse>(outputPath)).toMatchObject({
				revision: 3,
				name: 'Feature Table Updated',
			});

			const blockedDelete = await signedJson(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
				'DELETE',
				{ expectedRevision: 3 },
			);
			const blockedDisable = await signedJson(
				`/api/events/${eventId}`,
				'PATCH',
				{ broadcastDeckListsEnabled: false },
			);
			for (const refusal of [blockedDelete, blockedDisable]) {
				expect(refusal.status).toBe(409);
				expect(refusal.data).toMatchObject({
					data: {
						screens: [
							{ id: offMode.id, name: 'Off-mode Retainer' },
							{ id: programme.id, name: 'Programme' },
						],
					},
				});
			}
			expect((blockedDelete.data as { message: string }).message).toContain('Off-mode Retainer, Programme');
			expect((blockedDisable.data as { message: string }).message).toContain('Off-mode Retainer, Programme');

			for (const screen of [programme, offMode]) {
				const switched = await $fetch<ScreenResponse>(
					`/api/events/${eventId}/screens/${screen.id}/config/deck`,
					{
						method: 'PATCH',
						body: { deckSource: { type: 'player', playerId: null } },
					},
				);
				expect(switched.modeConfigs?.deck).toMatchObject({
					deckSource: { type: 'player', playerId: null },
					board: 'sideboard',
					showDeckName: false,
					showHighlanderPoints: false,
					quantityPosition: 'bottom-right',
				});
			}

			await expect($fetch(
				`/api/events/${eventId}/broadcast-deck-lists/${created.id}`,
				{ method: 'DELETE', body: { expectedRevision: 3 } },
			)).resolves.toEqual({ success: true });
			await expect($fetch(`/api/events/${eventId}`, {
				method: 'PATCH',
				body: { broadcastDeckListsEnabled: false },
			})).resolves.toMatchObject({ broadcastDeckListsEnabled: false });
			expect(await $fetch<BroadcastDeckListResponse>(
				`/api/events/${eventId}/broadcast-deck-lists/${reserve.id}`,
			)).toMatchObject({ id: reserve.id, revision: 1 });
			await $fetch(`/api/events/${eventId}`, {
				method: 'PATCH',
				body: { broadcastDeckListsEnabled: true },
			});
			expect((await $fetch<{ broadcastDeckLists: Array<{ id: number }> }>(
				`/api/events/${eventId}/broadcast-deck-lists`,
			)).broadcastDeckLists).toContainEqual(expect.objectContaining({ id: reserve.id }));

			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
			const cascaded = await queryIntegrationD1<{ lists: number; entries: number }>(`
				SELECT
					(SELECT count(*) FROM broadcast_deck_lists WHERE event_id = ?) AS lists,
					(SELECT count(*) FROM broadcast_deck_list_entries WHERE list_id IN (?, ?)) AS entries
			`, [eventId, created.id, reserve.id]);
			expect(cascaded).toEqual([{ lists: 0, entries: 0 }]);
			eventId = undefined;
		}
		finally {
			realtime?.close();
			if (eventId !== undefined) {
				try {
					await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
				}
				catch {}
			}
			if (otherEventId !== undefined) {
				try {
					await $fetch(`/api/events/${otherEventId}`, { method: 'DELETE' });
				}
				catch {}
			}
		}
	}, 60_000);
});
