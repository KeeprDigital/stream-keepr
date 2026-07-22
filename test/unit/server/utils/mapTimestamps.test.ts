import { describe, expect, it } from 'vitest';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

describe('mapTimestamps', () => {
	it('converts string timestamps to Date objects', () => {
		const input = {
			createdAt: '2024-06-15T10:30:00.000Z',
			updatedAt: '2024-06-16T14:00:00.000Z',
		};
		const result = mapTimestamps(input);

		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
		expect(result.createdAt.toISOString()).toBe('2024-06-15T10:30:00.000Z');
		expect(result.updatedAt.toISOString()).toBe('2024-06-16T14:00:00.000Z');
	});

	it('converts Date timestamps as passthrough', () => {
		const createdAt = new Date('2024-01-01T00:00:00.000Z');
		const updatedAt = new Date('2024-06-01T12:00:00.000Z');
		const input = { createdAt, updatedAt };
		const result = mapTimestamps(input);

		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
		expect(result.createdAt.getTime()).toBe(createdAt.getTime());
		expect(result.updatedAt.getTime()).toBe(updatedAt.getTime());
	});

	it('preserves all other fields', () => {
		const input = {
			id: 42,
			name: 'Test Event',
			active: true,
			tags: ['a', 'b'],
			createdAt: '2024-06-15T10:30:00.000Z',
			updatedAt: '2024-06-16T14:00:00.000Z',
		};
		const result = mapTimestamps(input);

		expect(result.id).toBe(42);
		expect(result.name).toBe('Test Event');
		expect(result.active).toBe(true);
		expect(result.tags).toEqual(['a', 'b']);
	});

	it('works with objects containing nullable fields', () => {
		const input = {
			id: 1,
			description: null,
			createdAt: '2024-03-10T08:00:00.000Z',
			updatedAt: '2024-03-10T08:00:00.000Z',
		};
		const result = mapTimestamps(input);

		expect(result.description).toBeNull();
		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
	});

	it('handles mixed string and Date timestamps', () => {
		const input = {
			createdAt: new Date('2024-01-01T00:00:00.000Z'),
			updatedAt: '2024-12-31T23:59:59.000Z',
		};
		const result = mapTimestamps(input);

		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
		expect(result.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
		expect(result.updatedAt.toISOString()).toBe('2024-12-31T23:59:59.000Z');
	});
});
