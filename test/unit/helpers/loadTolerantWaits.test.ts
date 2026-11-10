import { expect, it, vi } from 'vitest';

// A condition that holds only after Vitest's own one-second default has passed
// still resolves: a slow machine delays a wait, it does not fail it.
it.each([
	[
		'waitFor',
		(ready: () => boolean) => vi.waitFor(() => expect(ready()).toBe(true)),
	],
	[
		'waitUntil',
		(ready: () => boolean) => vi.waitUntil(ready),
	],
])('%s outlasts a condition slower than one second', async (_name, wait) => {
	const readyAt = Date.now() + 1_200;
	await expect(wait(() => Date.now() >= readyAt)).resolves.not.toThrow();
});

it('keeps a bound the wait names itself', async () => {
	await expect(vi.waitFor(() => expect(false).toBe(true), { timeout: 50 })).rejects.toThrow();
});
