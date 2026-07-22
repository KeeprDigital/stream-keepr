import { describe, expect, it } from 'vitest';
import {
	createEventSchema,
	eventParamsSchema,
	meleeConfigSchema,
	updateEventSchema,
} from '~~/server/schemas/api/event';

// ──────────────── createEventSchema ────────────────

describe('createEventSchema', () => {
	const validInput = {
		name: 'Pro Tour Chicago',
		game: 'mtg' as const,
		featureMatchOrientation: 'horizontal' as const,
	};

	it('accepts valid input with required fields only', () => {
		const result = createEventSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it('accepts valid input with all optional fields', () => {
		const result = createEventSchema.safeParse({
			...validInput,
			description: 'A competitive MTG event',
			holdingText: 'Live now: {roundLabel}',
			cardTimeout: 30,
			numFeatureMatches: 4,
			featureMatchDefaultBestOf: 3,
			featureMatchDefaultStartingLife: 20,
			featureMatchDefaultClockDuration: 50,
			featureMatchDefaultExtraTurns: 5,
			featureMatchDefaultExtraTurnsLabel: 'Extra Turns',
		});
		expect(result.success).toBe(true);
	});

	it('accepts zero-valued One Piece life and extra-turn policy', () => {
		const result = createEventSchema.safeParse({
			name: 'One Piece Regional',
			game: 'op',
			featureMatchDefaultStartingLife: 0,
			featureMatchDefaultExtraTurns: 0,
		});
		expect(result.success).toBe(true);
	});

	it('does not accept creation-time commentator references', () => {
		const result = createEventSchema.safeParse({
			...validInput,
			commentator1TalentId: 42,
		});
		expect(result.success).toBe(false);
	});

	// Required fields

	// name bounds

	it('accepts name of exactly 200 characters', () => {
		const result = createEventSchema.safeParse({ ...validInput, name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	// description bounds
	it('accepts description of exactly 5000 characters', () => {
		const result = createEventSchema.safeParse({ ...validInput, description: 'a'.repeat(5000) });
		expect(result.success).toBe(true);
	});

	it('accepts null description', () => {
		const result = createEventSchema.safeParse({ ...validInput, description: null });
		expect(result.success).toBe(true);
	});

	// holdingText bounds
	it('accepts holdingText of exactly 1000 characters', () => {
		const result = createEventSchema.safeParse({ ...validInput, holdingText: 'a'.repeat(1000) });
		expect(result.success).toBe(true);
	});

	it('accepts partial holdingText values', () => {
		const result = createEventSchema.safeParse({
			...validInput,
			holdingText: 'Live now: {roundLabel}',
		});
		expect(result.success).toBe(true);
	});

	// cardTimeout: 0-300
	it('accepts cardTimeout of 0', () => {
		const result = createEventSchema.safeParse({ ...validInput, cardTimeout: 0 });
		expect(result.success).toBe(true);
	});

	it('accepts cardTimeout of 300', () => {
		const result = createEventSchema.safeParse({ ...validInput, cardTimeout: 300 });
		expect(result.success).toBe(true);
	});

	// numFeatureMatches: 1-50
	it('accepts numFeatureMatches of 1', () => {
		const result = createEventSchema.safeParse({ ...validInput, numFeatureMatches: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts numFeatureMatches of 50', () => {
		const result = createEventSchema.safeParse({ ...validInput, numFeatureMatches: 50 });
		expect(result.success).toBe(true);
	});

	// featureMatchDefaultBestOf: 1-9
	it('accepts featureMatchDefaultBestOf of 1', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultBestOf: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts featureMatchDefaultBestOf of 9', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultBestOf: 9 });
		expect(result.success).toBe(true);
	});

	// featureMatchDefaultStartingLife: 1-99999
	it('accepts featureMatchDefaultStartingLife of 1', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultStartingLife: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts featureMatchDefaultStartingLife of 99999', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultStartingLife: 99999 });
		expect(result.success).toBe(true);
	});

	// featureMatchDefaultClockDuration: 0-999
	it('accepts featureMatchDefaultClockDuration of 0', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultClockDuration: 0 });
		expect(result.success).toBe(true);
	});

	it('accepts featureMatchDefaultClockDuration of 999', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultClockDuration: 999 });
		expect(result.success).toBe(true);
	});

	// featureMatchDefaultExtraTurns: 1-20
	it('accepts featureMatchDefaultExtraTurns of 1', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultExtraTurns: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts featureMatchDefaultExtraTurns of 20', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultExtraTurns: 20 });
		expect(result.success).toBe(true);
	});

	// featureMatchDefaultExtraTurnsLabel bounds

	it('accepts featureMatchDefaultExtraTurnsLabel of exactly 100 characters', () => {
		const result = createEventSchema.safeParse({ ...validInput, featureMatchDefaultExtraTurnsLabel: 'a'.repeat(100) });
		expect(result.success).toBe(true);
	});

	// game enum validation

	// featureMatchOrientation enum validation

	// Omitted fields should be stripped from output
});

// ──────────────── updateEventSchema ────────────────

describe('updateEventSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = updateEventSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts partial update with name only', () => {
		const result = updateEventSchema.safeParse({ name: 'New Name' });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with numeric fields', () => {
		const result = updateEventSchema.safeParse({
			cardTimeout: 60,
			numFeatureMatches: 8,
			featureMatchDefaultBestOf: 5,
		});
		expect(result.success).toBe(true);
	});

	it('rejects attempts to reinterpret an existing Event game', () => {
		const result = updateEventSchema.safeParse({ game: 'op', name: 'Still MTG' });
		expect(result.success).toBe(false);
	});

	it('rejects unknown and server-managed fields instead of silently discarding them', () => {
		expect(updateEventSchema.safeParse({ id: 123 }).success).toBe(false);
		expect(updateEventSchema.safeParse({ unexpected: true }).success).toBe(false);
	});

	// Same bounds as create

	it('accepts null description', () => {
		const result = updateEventSchema.safeParse({ description: null });
		expect(result.success).toBe(true);
	});
});

// ──────────────── eventParamsSchema ────────────────

describe('eventParamsSchema', () => {
	it('coerces string "1" to number 1', () => {
		const result = eventParamsSchema.safeParse({ id: '1' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
		}
	});

	it('accepts numeric id', () => {
		const result = eventParamsSchema.safeParse({ id: 42 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
		}
	});
});

// ──────────────── meleeConfigSchema ────────────────

describe('meleeConfigSchema', () => {
	it('accepts valid melee config with all fields populated', () => {
		const result = meleeConfigSchema.safeParse({
			meleeEnabled: true,
			meleeEventId: 'evt-123',
			meleeClientId: 'client-abc',
			meleeClientSecret: 'secret-xyz',
			liveMatchRefreshEnabled: true,
			liveMatchRefreshIntervalSeconds: 30,
		});
		expect(result.success).toBe(true);
	});

	it('accepts melee config with null optional fields', () => {
		const result = meleeConfigSchema.safeParse({
			meleeEnabled: false,
			meleeEventId: null,
			meleeClientId: null,
			meleeClientSecret: null,
			liveMatchRefreshEnabled: false,
			liveMatchRefreshIntervalSeconds: 30,
		});
		expect(result.success).toBe(true);
	});

	it('accepts meleeEventId of exactly 100 characters', () => {
		const result = meleeConfigSchema.safeParse({
			meleeEnabled: true,
			meleeEventId: 'a'.repeat(100),
			meleeClientId: 'client-abc',
			meleeClientSecret: 'secret-xyz',
			liveMatchRefreshEnabled: true,
			liveMatchRefreshIntervalSeconds: 30,
		});
		expect(result.success).toBe(true);
	});

	it('accepts meleeClientId of exactly 200 characters', () => {
		const result = meleeConfigSchema.safeParse({
			meleeEnabled: true,
			meleeEventId: 'evt-123',
			meleeClientId: 'a'.repeat(200),
			meleeClientSecret: 'secret-xyz',
			liveMatchRefreshEnabled: true,
			liveMatchRefreshIntervalSeconds: 30,
		});
		expect(result.success).toBe(true);
	});

	it('accepts meleeClientSecret of exactly 500 characters', () => {
		const result = meleeConfigSchema.safeParse({
			meleeEnabled: true,
			meleeEventId: 'evt-123',
			meleeClientId: 'client-abc',
			meleeClientSecret: 'a'.repeat(500),
			liveMatchRefreshEnabled: true,
			liveMatchRefreshIntervalSeconds: 30,
		});
		expect(result.success).toBe(true);
	});
});
