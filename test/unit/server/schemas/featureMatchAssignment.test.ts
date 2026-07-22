import { describe, expect, it } from 'vitest';
import { createFeatureMatchAssignmentSchema, updateFeatureMatchAssignmentSchema } from '~~/server/schemas/api/featureMatchAssignment';

describe('feature match assignment schemas', () => {
	it('accepts a valid assignment with note', () => {
		const result = createFeatureMatchAssignmentSchema.safeParse({
			roundId: 2,
			slotId: 3,
			matchId: 4,
			note: 'Watch the tempo mirror sideboarding.',
		});
		expect(result.success).toBe(true);
	});

	it('requires positive ids', () => {
		const result = createFeatureMatchAssignmentSchema.safeParse({
			roundId: 0,
			slotId: 3,
			matchId: 4,
		});
		expect(result.success).toBe(false);
	});

	it('accepts note-only updates', () => {
		expect(updateFeatureMatchAssignmentSchema.safeParse({ note: null }).success).toBe(true);
		expect(updateFeatureMatchAssignmentSchema.safeParse({ note: 'x'.repeat(5001) }).success).toBe(false);
	});
});
