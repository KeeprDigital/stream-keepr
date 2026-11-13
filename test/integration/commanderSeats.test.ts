import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KRAUM, TYMNA } from '../helpers/commanders';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

// One pass through the API boundary: a Commander Slot's Seats are saved, read and swapped (ADR-0087).
describe('a Commander Event\'s Feature Match Slot Seats', () => {
	let eventId: number;
	let slotId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration Commander Seats Event',
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

	it('saves a Seat with two Commanders, swaps it into another Seat, and reads both back', async () => {
		await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: { name: 'Ana' },
				player3Data: {
					name: 'Cyd',
					gameData: {
						type: 'mtg',
						commanders: [TYMNA, KRAUM],
					},
				},
			},
		});

		const swapped = await $fetchRaw(`/api/events/${eventId}/feature-match-slots/${slotId}/swap-seats`, {
			method: 'POST',
			body: {
				seats: ['player1', 'player3'],
			},
		});
		expect(swapped.status).toBe(200);

		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}`);
		expect(slot.player1Data).toEqual({
			name: 'Cyd',
			gameData: {
				type: 'mtg',
				commanders: [TYMNA, KRAUM],
				deckName: 'Tymna the Weaver / Kraum, Ludevic\'s Opus',
				deckColors: 'WUBR',
			},
		});
		expect(slot.player3Data).toEqual({ name: 'Ana' });
	});

	it('refuses a Seat naming a third Commander', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player2Data: {
					name: 'Ben',
					gameData: {
						type: 'mtg',
						commanders: [TYMNA, KRAUM, TYMNA],
					},
				},
			},
		});

		expect(res.status).toBe(400);
	});
});
