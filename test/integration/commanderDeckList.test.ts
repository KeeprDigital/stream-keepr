import type { CommanderDeckListPreviewAnswer, SaveCommanderDeckListAnswer, SavedCommanderDeckList } from '~~/shared/types/featureMatchDeckList';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

// One pass through the API boundary: a Commander Seat's pasted Deck List is previewed,
// saved with its Commander confirmed, and read back (ADR-0087). Scryfall answers the
// synthetic `it2` set (`mock-scryfall.mjs`).

const COMMANDER = '5e1f0c1a-8f0b-4c36-9d7e-2b6a4d1c0e01';
const PASTE = [
	'1 Integration Commander (IT2) 1',
	'3 Integration Land (IT2) 2p *F*',
	'',
	'SIDEBOARD:',
	'1 Integration Bolt (IT1) 1',
].join('\n');

describe('a Commander Seat\'s Feature Match Deck List', () => {
	let eventId: number;
	let slotId: number;
	const route = (suffix = '') => `/api/events/${eventId}/feature-match-slots/${slotId}/commander-deck-lists${suffix}`;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration Commander Deck List Event',
				game: 'mtg',
				variant: 'commander',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, { method: 'POST', body: {} });
		slotId = slot.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('previews a paste, saves it with the offered Commander, and reads back each card as the printing named', async () => {
		const preview = await $fetch<CommanderDeckListPreviewAnswer>(route('/preview'), {
			method: 'POST',
			body: { text: PASTE },
		});
		expect(preview).toMatchObject({
			ok: true,
			deckList: {
				offeredCommanders: [COMMANDER],
				sideboardDropped: 1,
			},
		});

		const saved = await $fetch<SaveCommanderDeckListAnswer<unknown>>(route(), {
			method: 'POST',
			body: {
				seat: 'player4',
				text: PASTE,
				commanders: [COMMANDER],
			},
		});

		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`);
		expect(slot.player4Data).toEqual({
			gameData: {
				type: 'mtg',
				commanders: [
					{
						scryfallId: COMMANDER,
						name: 'Integration Commander',
						colorIdentity: 'UG',
						setCode: 'it2',
						collectorNumber: '1',
					},
				],
				deckName: 'Integration Commander',
				deckColors: 'UG',
				featureMatchDeckList: { id: saved.deckList.id, mainboardCount: 3 },
			},
		});
		const read = await $fetch<SavedCommanderDeckList>(route(`/${saved.deckList.id}`));
		expect(read.entries.map(entry =>
			[
				entry.quantity,
				entry.name,
				entry.setCode,
				entry.collectorNumber,
			])).toEqual([
			[1, 'Integration Commander', 'it2', '1'],
			[3, 'Integration Land', 'it2', '2p'],
		]);
	});

	it('refuses a line naming a printing that does not exist, on the preview and the save', async () => {
		const text = '1 Integration Commander (IT2) 1\n1 Integration Land (IT2) 999';

		const preview = await $fetch(route('/preview'), {
			method: 'POST',
			body: { text },
		});
		const save = await $fetchRaw(route(), {
			method: 'POST',
			body: {
				seat: 'player1',
				text,
				commanders: [COMMANDER],
			},
		});

		const refusal = { code: 'INVALID_PRINTING_HINT', lineNumber: 2, sourceText: '1 Integration Land (IT2) 999' };
		expect(preview).toMatchObject({
			ok: false,
			errors: [refusal],
		});
		expect(save.status).toBe(422);
		expect(save._data).toMatchObject({
			data: {
				code: 'COMMANDER_DECK_LIST_INVALID',
				errors: [refusal],
			},
		});
	});
});
