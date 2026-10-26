import { describe, expect, expectTypeOf, it } from 'vitest';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

describe('mapTimestamps', () => {
	it('turns string and Date timestamps into Dates, leaving every other field alone', () => {
		const result = mapTimestamps({
			id: 42,
			description: null,
			createdAt: new Date('2024-01-01T00:00:00.000Z'),
			updatedAt: '2024-12-31T23:59:59.000Z',
		});

		expect(result).toEqual({
			id: 42,
			description: null,
			createdAt: new Date('2024-01-01T00:00:00.000Z'),
			updatedAt: new Date('2024-12-31T23:59:59.000Z'),
		});
	});
});

// Checked by `pnpm typecheck:test`: the declared return type describes the
// runtime conversion (#256).
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
		const result = mapTimestamps({
			createdAt: new Date(),
			updatedAt: new Date(),
			reversalCompletesAt: 250,
		});

		expectTypeOf(result.reversalCompletesAt).toEqualTypeOf<number>();
	});

	it('keeps an optional timestamp optional', () => {
		const result = mapTimestamps({
			createdAt: new Date(),
			updatedAt: new Date(),
		} as {
			createdAt: Date;
			updatedAt: Date;
			resolvedAt?: string;
		});

		expectTypeOf(result).toEqualTypeOf<{ createdAt: Date; updatedAt: Date; resolvedAt?: Date }>();
	});
});
