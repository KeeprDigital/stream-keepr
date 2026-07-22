import { describe, expect, it } from 'vitest';
import { randomCommandId, randomUuid } from '~~/app/utils/uuid';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid', () => {
	it('generates RFC4122-shaped v4 UUIDs without crypto APIs', () => {
		expect(randomUuid()).toMatch(UUID_V4_REGEX);
	});

	it('produces distinct values across calls', () => {
		const values = new Set(Array.from({ length: 25 }, () => randomUuid()));
		expect(values.size).toBe(25);
	});
});

describe('randomCommandId', () => {
	it('uses the shared command id format', () => {
		expect(randomCommandId('TestCommand')).toMatch(/^TestCommand:\d+:\d+:[0-9a-f-]{36}$/);
	});
});
