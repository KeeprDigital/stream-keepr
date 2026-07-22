import type { FeatureMatchAssignment } from '~/types';

function sameRoundSlot(left: FeatureMatchAssignment, right: FeatureMatchAssignment): boolean {
	return left.roundId === right.roundId && left.slotId === right.slotId;
}

/**
 * Feature Match Assignment collection module.
 *
 * Owns the client-side invariants for Round-scoped saved selections:
 * - one Match can appear in at most one Feature Match Slot within the loaded Round
 * - one Feature Match Slot has at most one assignment within the loaded Round
 * - server-returned assignments replace local optimistic or stale entries
 */
export function applySavedFeatureMatchAssignment(
	assignments: FeatureMatchAssignment[],
	saved: FeatureMatchAssignment,
): FeatureMatchAssignment[] {
	const filtered = assignments.filter(existing =>
		existing.id === saved.id
		|| existing.roundId !== saved.roundId
		|| (existing.matchId !== saved.matchId && !sameRoundSlot(existing, saved)),
	);

	const index = filtered.findIndex(existing => existing.id === saved.id || sameRoundSlot(existing, saved));
	if (index >= 0) {
		return filtered.map((existing, existingIndex) => existingIndex === index ? saved : existing);
	}

	return [...filtered, saved];
}

export function applyUpdatedFeatureMatchAssignment(
	assignments: FeatureMatchAssignment[],
	assignmentId: number,
	updated: FeatureMatchAssignment,
): FeatureMatchAssignment[] {
	return applySavedFeatureMatchAssignment(
		assignments.filter(existing => existing.id !== assignmentId || existing.id === updated.id),
		updated,
	);
}
