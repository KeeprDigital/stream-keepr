import type { ClockState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import Clock from '~/components/FeatureMatch/State/Clock.vue';

mockNuxtImport('useServerTime', () => () => ({
	isSynced: ref(true),
	serverTimeOffset: ref(0),
	getServerTime: () => Date.now(),
}));
mockNuxtImport('useEventStore', () => () => ({
	eventId: 1,
	displayEvent: createMockEvent({ featureMatchDefaultUntimedLabel: 'Top 8' }),
}));
mockNuxtImport('useClockControls', () => () => ({
	defaultDurationMs: computed(() => undefined),
	start: vi.fn(),
	pause: vi.fn(),
}));
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }));

function clock(overrides: Partial<ClockState> = {}): ClockState {
	return {
		type: 'countdown',
		durationMs: 10_000,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: false,
		...overrides,
	};
}

const running = (sinceStartMs: number, overrides: Partial<ClockState> = {}) =>
	clock({ isRunning: true, lastStartedAt: Date.now() - sinceStartMs, ...overrides });

function mountClock(state: ClockState) {
	return mount(Clock, {
		props: { matchId: 1, clock: state },
		global: { stubs: nuxtUiStubs },
	});
}

describe('featureMatchStateClock', () => {
	// Its clock takes its state's colour, pulse and overtime mark; which state takes which is clockAppearance's own test.
	it.each([
		{ name: 'run out and still running', state: running(15_000), time: ['text-error', 'animate-pulse'], ringed: false },
		{
			name: 'counting up after running out',
			state: running(15_000, { countUpAfterCountdown: true }),
			time: ['text-error'],
			ringed: true,
		},
	])('draws a clock $name as $time', ({ state, time, ringed }) => {
		const wrapper = mountClock(state);

		expect(wrapper.get('[data-clock-state]').classes()).toEqual(expect.arrayContaining(time));
		expect(wrapper.get('[data-clock-state]').classes().includes('animate-pulse')).toBe(time.includes('animate-pulse'));
		expect(wrapper.get('button[aria-label="Clock controls"]').classes().includes('ring-error')).toBe(ringed);
	});

	it('shows an untimed match by the Event\'s Untimed Label', () => {
		expect(mountClock(clock({ type: 'untimed' })).get('[data-clock-state]').text()).toBe('Top 8');
	});

	// A clock stored running with no start reads as stopped, so it offers a start, not a pause that does nothing.
	it.each([
		['a running clock', running(1000), 'i-lucide-pause'],
		['a stopped clock', clock(), 'i-lucide-play'],
		['a clock stored running with no start', clock({ isRunning: true }), 'i-lucide-play'],
	])('offers %s the control that will act on it', async (_, state, icon) => {
		const wrapper = mountClock(state);
		await wrapper.get('button[aria-label="Clock controls"]').trigger('click');

		const transport = wrapper.findAll('[data-icon]')
			.map(found => found.attributes('data-icon'))
			.filter(name => name === 'i-lucide-play' || name === 'i-lucide-pause');
		expect(transport).toEqual([icon]);
	});
});
