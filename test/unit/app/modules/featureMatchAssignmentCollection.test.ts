import type { FeatureMatchAssignment } from '~/types';
import { describe, expect, it } from 'vitest';
import { applySavedFeatureMatchAssignment, applyUpdatedFeatureMatchAssignment } from '~/modules/feature-match-assignment/collection';

function assignment(overrides: Partial<FeatureMatchAssignment> = {}): FeatureMatchAssignment {
	return {
		id: 1,
		eventId: 1,
		roundId: 10,
		slotId: 100,
		matchId: 1000,
		note: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides,
	};
}

describe('feature Match Assignment collection', () => {
	it('replaces an existing assignment for the same Round and Feature Match Slot', () => {
		const existing = assignment({ id: 1, slotId: 100, matchId: 1000 });
		const saved = assignment({ id: 2, slotId: 100, matchId: 2000 });

		expect(applySavedFeatureMatchAssignment([existing], saved)).toEqual([saved]);
	});

	it('removes the previous slot assignment for the same Match in the loaded Round', () => {
		const oldSlot = assignment({ id: 1, slotId: 100, matchId: 1000 });
		const otherRound = assignment({ id: 2, roundId: 11, slotId: 200, matchId: 1000 });
		const saved = assignment({ id: 3, slotId: 300, matchId: 1000 });

		expect(applySavedFeatureMatchAssignment([oldSlot, otherRound], saved)).toEqual([otherRound, saved]);
	});

	it('updates by assignment id while preserving uniqueness rules', () => {
		const current = assignment({ id: 1, slotId: 100, matchId: 1000 });
		const staleSameMatch = assignment({ id: 2, slotId: 200, matchId: 3000 });
		const updated = assignment({ id: 1, slotId: 100, matchId: 3000, note: 'keep' });

		expect(applyUpdatedFeatureMatchAssignment([current, staleSameMatch], 1, updated)).toEqual([updated]);
	});
});
