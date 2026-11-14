import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clock } from '~~/test/nuxt/helpers/featureMatchStateHarness';

mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime());

describe('useClockDisplay', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	// What it shows, its state and whether it runs are the clock's projection, each
	// answered anew as it changes; when that is, is the scheduler's own test.
	it('counts a running countdown down to its end, answering run out and still running as it shows 0:00', async () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const display = useClockDisplay(clock({ durationMs: 2000, isRunning: true, lastStartedAt: 1_000_000 }), '');
		const shown = () => [display.displayTime.value, display.state.value, display.isRunning.value];
		expect(shown()).toEqual(['0:02', 'running', true]);

		await vi.advanceTimersByTimeAsync(1000);
		expect(shown()).toEqual(['0:01', 'running', true]);

		await vi.advanceTimersByTimeAsync(1000);
		expect(shown()).toEqual(['0:00', 'run-out', true]);
	});

	// The Untimed Label is its caller's to pass; a blank one hides the clock.
	it.each([
		[
			'blank',
			' ',
			{ displayTime: '', showsClock: false },
		],
		[
			'set',
			' Untimed ',
			{ displayTime: 'Untimed', showsClock: true },
		],
	])('shows an untimed match by the Untimed Label it is passed, with no clock while it is %s', (_, label, expected) => {
		const display = useClockDisplay(clock({ type: 'untimed' }), () => label);

		expect({ displayTime: display.displayTime.value, showsClock: display.showsClock.value }).toEqual(expected);
	});

	it('follows the Untimed Label as its caller changes it', async () => {
		const label = ref('');
		const display = useClockDisplay(clock({ type: 'untimed' }), label);
		expect(display.showsClock.value).toBe(false);

		label.value = 'Top 8';
		await nextTick();

		expect([display.displayTime.value, display.showsClock.value]).toEqual(['Top 8', true]);
	});
});
