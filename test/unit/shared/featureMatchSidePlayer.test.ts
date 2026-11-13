import { describe, expect, it } from 'vitest';
import { featureMatchSidePlayer, seatLabel } from '~~/shared/utils/featureMatchSidePlayer';

const ana = {
	playerId: 1,
	data: { name: 'Ana' },
};
const ben = {
	playerId: 2,
	data: { name: 'Ben' },
};
const slot = {
	player1Id: 1,
	player2Id: 2,
	player1Data: { name: 'Ana' },
	player2Data: { name: 'Ben' },
};

describe('the player a Feature Match Slot side shows', () => {
	// The active Session owns side order; the Slot keeps pairing order (ADR-0058).
	it.each([
		{
			with: 'no active Session',
			activeSession: null,
			left: ana,
			right: ben,
		},
		{
			with: 'an active Session in Slot order',
			activeSession: {
				sourceSnapshot: { player1: ana, player2: ben },
			},
			left: ana,
			right: ben,
		},
		{
			with: 'an active swapped Session',
			activeSession: {
				sourceSnapshot: { player1: ben, player2: ana },
			},
			left: ben,
			right: ana,
		},
		{
			with: 'an active Session seating nobody on a side',
			activeSession: {
				sourceSnapshot: { player1: ben, player2: null },
			},
			left: ben,
			right: { playerId: null, data: null },
		},
	])('reads $with', ({ activeSession, left, right }) => {
		expect(featureMatchSidePlayer({ ...slot, activeSession }, 'player1')).toEqual(left);
		expect(featureMatchSidePlayer({ ...slot, activeSession }, 'player2')).toEqual(right);
	});

	// Seats 3 and 4 are a Commander Slot's: typed, linking no Player (ADR-0087).
	it.each([
		{
			with: 'no active Session, from the Slot\'s own Seat',
			activeSession: null,
			seated: {
				playerId: null,
				data: { name: 'Cyd' },
			},
		},
		{
			with: 'an active Session, from its snapshot',
			activeSession: {
				sourceSnapshot: {
					player1: ana,
					player2: ben,
					player3: {
						playerId: null,
						data: { name: 'Dee' },
					},
				},
			},
			seated: {
				playerId: null,
				data: { name: 'Dee' },
			},
		},
	])('reads Seat 3 with $with', ({ activeSession, seated }) => {
		const commanderSlot = {
			...slot,
			player3Data: { name: 'Cyd' },
			activeSession,
		};

		expect(featureMatchSidePlayer(commanderSlot, 'player3')).toEqual(seated);
		expect(featureMatchSidePlayer(commanderSlot, 'player4')).toEqual({ playerId: null, data: null });
	});

	it('seats nobody without a Slot', () => {
		expect(featureMatchSidePlayer(null, 'player1')).toEqual({ playerId: null, data: null });
	});
});

describe('a Seat as a layout\'s author names it', () => {
	// A Commander Slot's places are Seats; a pair's are its two Players (ADR-0087).
	it.each([
		['mtg-two-player', 'player2', 'Player 2'],
		['mtg-commander', 'player2', 'Seat 2'],
		['mtg-commander', 'player4', 'Seat 4'],
	] as const)('on a %s Event names %s "%s"', (kind, seat, label) => {
		expect(seatLabel(kind, seat)).toBe(label);
	});
});
