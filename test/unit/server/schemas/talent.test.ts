import { describe, expect, it } from 'vitest';
import {
	createTalentSchema,
	talentParamsSchema,
	updateTalentSchema,
} from '~~/server/schemas/api/talent';
import { MAX_SOCIAL_PROFILE_HANDLE_LENGTH } from '~~/shared/socialProfiles';

// ──────────────── createTalentSchema ────────────────

describe('createTalentSchema', () => {
	it('accepts valid name', () => {
		const result = createTalentSchema.safeParse({ name: 'Alice' });
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 200 characters', () => {
		const result = createTalentSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	it('normalizes a populated Social Profile subset and removes blank entries', () => {
		const result = createTalentSchema.parse({
			name: 'Alice',
			socialProfiles: {
				twitch: '  @AliceLive ',
				youtube: 'https://youtube.com/@AliceOnVideo',
				x: ' ',
			},
		});

		expect(result.socialProfiles).toEqual({
			twitch: 'AliceLive',
			youtube: 'AliceOnVideo',
		});
	});

	it('reports a wrong-network URL against its Social Profile field', () => {
		const result = createTalentSchema.safeParse({
			name: 'Alice',
			socialProfiles: { twitch: 'https://x.com/Alice' },
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toContainEqual(expect.objectContaining({
				path: ['socialProfiles', 'twitch'],
			}));
		}
	});

	it('rejects a Social Profile handle beyond the bounded live-document ceiling', () => {
		expect(createTalentSchema.safeParse({
			name: 'Alice',
			socialProfiles: { twitch: 'a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH + 1) },
		}).success).toBe(false);
	});
});

// ──────────────── updateTalentSchema ────────────────

describe('updateTalentSchema', () => {
	it('accepts valid name', () => {
		const result = updateTalentSchema.safeParse({ name: 'Bob' });
		expect(result.success).toBe(true);
	});

	it('accepts empty object (name is optional)', () => {
		const result = updateTalentSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 200 characters', () => {
		const result = updateTalentSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	it('distinguishes omitted, replacement and clearing Social Profile updates', () => {
		expect(updateTalentSchema.parse({})).toEqual({});
		expect(updateTalentSchema.parse({ socialProfiles: { instagram: '@Alice' } })).toEqual({
			socialProfiles: { instagram: 'Alice' },
		});
		expect(updateTalentSchema.parse({ socialProfiles: {} })).toEqual({ socialProfiles: {} });
	});
});

// ──────────────── talentParamsSchema ────────────────

describe('talentParamsSchema', () => {
	it('coerces string "1" to number for id', () => {
		const result = talentParamsSchema.safeParse({ id: '1', talentId: '2' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
		}
	});

	it('coerces string "2" to number for talentId', () => {
		const result = talentParamsSchema.safeParse({ id: '1', talentId: '2' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.talentId).toBe(2);
		}
	});

	it('accepts numeric id and talentId', () => {
		const result = talentParamsSchema.safeParse({ id: 42, talentId: 7 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
			expect(result.data.talentId).toBe(7);
		}
	});
});
