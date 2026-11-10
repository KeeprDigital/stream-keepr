import { expect, it, vi } from 'vitest';
import { LOAD_TOLERANT_WAIT_MS } from '../../helpers/loadTolerantBounds';

type WaitOptions = Parameters<typeof vi.waitFor>[1];

const waits = {
	waitFor: (ready: () => boolean, options?: WaitOptions) => vi.waitFor(() => expect(ready()).toBe(true), options),
	waitUntil: (ready: () => boolean, options?: WaitOptions) => vi.waitUntil(ready, options),
};
const waitNames = Object.keys(waits) as Array<keyof typeof waits>;

// A condition that holds only after Vitest's own one-second default has passed
// still resolves: a slow machine delays a wait, it does not fail it. Options
// that name no bound, or name `undefined`, leave the default standing.
it.each(waitNames.flatMap(name => [
	{ name, options: undefined },
	{
		name,
		options: { interval: 20 },
	},
	{
		name,
		options: { timeout: undefined },
	},
]))('$name outlasts a condition slower than one second, given $options', async ({ name, options }) => {
	const readyAt = Date.now() + 1_200;

	await waits[name](() => Date.now() >= readyAt, options);

	expect(Date.now()).toBeGreaterThanOrEqual(readyAt);
});

// A wait that names its own bound gives up at it, not at the default.
const NAMED_BOUND_MS = 50;
it.each(waitNames.flatMap(name => [
	{ name, options: NAMED_BOUND_MS },
	{
		name,
		options: { timeout: NAMED_BOUND_MS },
	},
]))('$name gives up at the bound it names, given $options', async ({ name, options }) => {
	const startedAt = Date.now();

	await expect(waits[name](() => false, options)).rejects.toThrow();

	expect(Date.now() - startedAt).toBeLessThan(LOAD_TOLERANT_WAIT_MS / 2);
});
