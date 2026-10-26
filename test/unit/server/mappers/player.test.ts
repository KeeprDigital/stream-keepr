import { describe, expect, it } from 'vitest';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { createMockPlayer } from '~~/test/helpers/fixtures';

describe('player mapper', () => {
	it('keeps Melee lifecycle bookkeeping internal', () => {
		const result = mapPlayerToResponse(createMockPlayer({
			name: 'Reid Duke',
			externalStatus: 7,
			isActive: false,
			lastSeenAt: new Date('2026-04-15T12:00:00.000Z'),
		}));

		expect(result.name).toBe('Reid Duke');
		expect(result).not.toHaveProperty('externalStatus');
		expect(result).not.toHaveProperty('isActive');
		expect(result).not.toHaveProperty('lastSeenAt');
	});
});
