import { afterEach, expect, it, vi } from 'vitest';

// A Screen Output corrects its clock drift against this reading, so it is the
// server's clock in epoch milliseconds, the unit every schedule is stamped in.

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);

const readTime = (await import('~~/server/api/time.get')).default as unknown as () => { serverTime: number };

afterEach(() => vi.useRealTimers());

it('answers the server clock in epoch milliseconds', () => {
	vi.useFakeTimers({
		now: new Date('2026-11-12T10:00:00.250Z'),
	});

	expect(readTime()).toEqual({ serverTime: 1_794_477_600_250 });
});
