import type { FeatureMatchSessionCommand } from '~~/shared/types/featureMatchSession';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEAT_VALUES } from '../../shared/types/enums';
import { ATRAXA, KRAUM, TYMNA } from '../helpers/commanders';
import { $fetch } from './client';
import { commandId, getFeatureMatchSlot, requireActiveSession, sendFeatureMatchCommand } from './featureMatchSessionHelpers';
import { $fetchRaw } from './helpers';

// One pass through the API boundary: a Commander Slot's Session plays its four Seats (ADR-0087).
describe('a Commander Event\'s Feature Match Session', () => {
	let eventId: number;
	let slotId: number;

	const session = async () => requireActiveSession(await getFeatureMatchSlot(eventId, slotId));
	const lifeBySeat = async () => {
		const { currentState } = await session();
		return SEAT_VALUES.map(seat => currentState[seat]?.lifeTotal);
	};

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Integration Commander Session Event',
				game: 'mtg',
				variant: 'commander',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, { method: 'POST', body: {} });
		slotId = slot.id;
		await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/setup`, {
			method: 'PATCH',
			body: {
				player1Data: {
					name: 'Ana',
					gameData: {
						type: 'mtg',
						commanders: [ATRAXA],
					},
				},
				player2Data: {
					name: 'Ben',
					gameData: {
						type: 'mtg',
						commanders: [TYMNA, KRAUM],
					},
				},
			},
		});
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('takes Commander Damage, refuses a game win, and moves a player\'s life with them on Swap Seats', async () => {
		const opened = await session();
		expect(opened.sourceSnapshot.variant).toBe('commander');
		expect(await lifeBySeat()).toEqual([40, 40, 40, 40]);

		const damaged = await sendFeatureMatchCommand(eventId, opened.id, {
			commandId: commandId('AdjustCommanderDamage'),
			type: 'AdjustCommanderDamage',
			payload: {
				player: 'player1',
				from: 'player2',
				commander: 2,
				delta: 6,
			},
		});
		expect(damaged.currentState.player1).toMatchObject({
			lifeTotal: 34,
			commanderDamage: [
				{ seat: 'player2', commander: 2, damage: 6 },
			],
		});

		const gameWin = await $fetchRaw(`/api/events/${eventId}/feature-match-sessions/${opened.id}/commands`, {
			method: 'POST',
			body: {
				commandId: commandId('RecordGameWin'),
				type: 'RecordGameWin',
				payload: { player: 'player1' },
				baseSequence: damaged.sequence,
			} satisfies FeatureMatchSessionCommand,
		});
		expect(gameWin.status).toBe(400);

		await $fetch(`/api/events/${eventId}/feature-match-slots/${slotId}/swap-seats`, {
			method: 'POST',
			body: {
				seats: ['player1', 'player4'],
			},
		});
		expect(await lifeBySeat()).toEqual([40, 40, 40, 34]);
		expect((await session()).currentState.player4?.commanderDamage).toEqual([
			{ seat: 'player2', commander: 2, damage: 6 },
		]);
	});
});
