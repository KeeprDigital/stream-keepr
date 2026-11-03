import { describe, expect, it } from 'vitest';
import { featureMatchSidePlayer } from '~~/shared/utils/featureMatchSidePlayer';

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

	it('seats nobody without a Slot', () => {
		expect(featureMatchSidePlayer(null, 'player1')).toEqual({ playerId: null, data: null });
	});
});
