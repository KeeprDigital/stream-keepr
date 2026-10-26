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
