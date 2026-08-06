import { describe, expect, expectTypeOf, it } from 'vitest';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

/**
 * The declared return type now says `Date` (#256), but a type is a claim and this
 * is the check: it reads the runtime type rather than asserting on it, so the test
 * still fails if the conversion ever stops happening while the signature keeps
 * promising it. The type-level block at the bottom guards the other direction.
 */
function convertedToDate(value: Date | string): Date {
	if (!(value instanceof Date))
		throw new TypeError(`expected mapTimestamps to have produced a Date, got ${typeof value}`);
	return value;
}

describe('mapTimestamps', () => {
	it('converts string timestamps to Date objects', () => {
		const input = {
			createdAt: '2024-06-15T10:30:00.000Z',
			updatedAt: '2024-06-16T14:00:00.000Z',
		};
		const result = mapTimestamps(input);

		expect(result.createdAt).toBeInstanceOf(Date);
		expect(result.updatedAt).toBeInstanceOf(Date);
		expect(convertedToDate(result.createdAt).toISOString()).toBe('2024-06-15T10:30:00.000Z');
		expect(convertedToDate(result.updatedAt).toISOString()).toBe('2024-06-16T14:00:00.000Z');
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
		expect(convertedToDate(result.createdAt).toISOString()).toBe('2024-01-01T00:00:00.000Z');
		expect(convertedToDate(result.updatedAt).toISOString()).toBe('2024-12-31T23:59:59.000Z');
	});
});

/**
 * These assert nothing at run time — they are checked by `pnpm typecheck:test`,
 * which covers this tree (#255). They exist because the defect #256 fixed was
 * invisible to every runtime test in this file: the conversion worked and the
 * signature described it wrongly, and only a reader ever noticed.
 */
describe('mapTimestamps return type', () => {
	it('reports a string timestamp as the Date it becomes', () => {
		const result = mapTimestamps({ createdAt: '2024-06-15T10:30:00.000Z', updatedAt: '2024-06-16T14:00:00.000Z' });

		expectTypeOf(result).toEqualTypeOf<{ createdAt: Date; updatedAt: Date }>();
	});

	it('keeps a nullable timestamp nullable and leaves non-timestamp keys alone', () => {
		const result = mapTimestamps({
			createdAt: new Date(),
			updatedAt: new Date(),
			lastSeenAt: null as string | null,
			name: 'a name',
		});

		expectTypeOf(result.lastSeenAt).toEqualTypeOf<Date | null>();
		expectTypeOf(result.name).toEqualTypeOf<string>();
	});

	it('leaves an At key alone when it holds something the body never rewrites', () => {
		const result = mapTimestamps({ createdAt: new Date(), updatedAt: new Date(), reversalCompletesAt: 250 });

		expectTypeOf(result.reversalCompletesAt).toEqualTypeOf<number>();
	});

	it('keeps an optional timestamp optional', () => {
		const result = mapTimestamps({ createdAt: new Date(), updatedAt: new Date() } as {
			createdAt: Date;
			updatedAt: Date;
			resolvedAt?: string;
		});

		expectTypeOf(result).toEqualTypeOf<{ createdAt: Date; updatedAt: Date; resolvedAt?: Date }>();
	});
});
