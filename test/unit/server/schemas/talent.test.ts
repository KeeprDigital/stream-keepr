import { describe, expect, it } from 'vitest';
import { createTalentSchema, updateTalentSchema } from '~~/server/schemas/api/talent';
import { MAX_SOCIAL_PROFILE_HANDLE_LENGTH } from '~~/shared/socialProfiles';

describe('createTalentSchema', () => {
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

		expect(result.error?.issues).toContainEqual(expect.objectContaining({
			path: ['socialProfiles', 'twitch'],
		}));
	});

	it('bounds a Social Profile handle to the live-document ceiling', () => {
		const withHandle = (length: number) => ({
			name: 'Alice',
			socialProfiles: {
				twitch: 'a'.repeat(length),
			},
		});

		expect(createTalentSchema.safeParse(withHandle(MAX_SOCIAL_PROFILE_HANDLE_LENGTH)).success).toBe(true);
		expect(createTalentSchema.safeParse(withHandle(MAX_SOCIAL_PROFILE_HANDLE_LENGTH + 1)).success).toBe(false);
	});
});

describe('updateTalentSchema', () => {
	it('distinguishes omitted, replacement and clearing Social Profile updates', () => {
		expect(updateTalentSchema.parse({})).toEqual({});
		expect(updateTalentSchema.parse({
			socialProfiles: { instagram: '@Alice' },
		})).toEqual({
			socialProfiles: { instagram: 'Alice' },
		});
		expect(updateTalentSchema.parse({ socialProfiles: {} })).toEqual({ socialProfiles: {} });
	});
});

describe('a Talent role', () => {
	it.each([
		['trimmed', '  Host  ', 'Host'],
		['blank, stored as none', '   ', null],
		['cleared', null, null],
	])('is %s', (_case, role, stored) => {
		expect(createTalentSchema.parse({ name: 'Alice', role }).role).toBe(stored);
		expect(updateTalentSchema.parse({ role }).role).toBe(stored);
	});

	it('is left alone when an update omits it', () => {
		expect(updateTalentSchema.parse({ name: 'Alice' })).not.toHaveProperty('role');
	});

	it.each([
		[100, true],
		[101, false],
	])('accepts a role of %i characters: %s', (length, accepted) => {
		expect(updateTalentSchema.safeParse({
			role: 'r'.repeat(length),
		}).success).toBe(accepted);
	});
});
