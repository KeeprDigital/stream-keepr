import type { EffectScope } from 'vue';
import type { ScreenOutputRoundClockResponse, ScreenOutputRoundClockRound } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';

const config = reactive({
	roundId: undefined as number | undefined,
	showRoundName: true,
	countUpAfterEnd: false,
	countUpLimitMinutes: undefined as number | undefined,
});
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('useScreenModeConfig', () => () => computed(() => config));
// The shared clock, faked: server time is this browser's.
mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime());

const screenContext = screenContextOf({
	screen: ref({ id: 1, name: 'Clock' }),
	eventId: ref(1),
	interactive: ref(false),
});

const START = Date.parse('2026-11-04T10:00:00.000Z');
const MINUTE = 60_000;

function answer(round: Partial<ScreenOutputRoundClockRound> | null): ScreenOutputRoundClockResponse {
	return {
		round: round && {
			id: 31,
			name: 'Round 4',
			startedAt: new Date(START).toISOString(),
			durationMinutes: 50,
			...round,
		},
	};
}

const scopes: EffectScope[] = [];

function makeRoundClockModeData() {
	const scope = effectScope();
	const result = scope.run(() => useRoundClockModeData(screenContext))!;
	scopes.push(scope);
	return result;
}

describe('useRoundClockModeData', () => {
	beforeEach(() => {
		vi.useFakeTimers({
			toFake: ['Date', 'setTimeout', 'clearTimeout'],
		});
		vi.setSystemTime(START + 10 * MINUTE);
		config.roundId = undefined;
		config.countUpAfterEnd = false;
		config.countUpLimitMinutes = undefined;
		realtime.reset();
		mockFetch.mockReset();
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
		vi.useRealTimers();
	});

	it('reads the Round through the Screen and counts down by server time, writing nothing', async () => {
		mockFetch.mockResolvedValue(answer({}));

		const { round, clock } = makeRoundClockModeData();
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/round-clock', expect.anything());
		expect(round.value?.name).toBe('Round 4');
		expect(clock.value).toMatchObject({ state: 'running', display: '40:00' });

		// It re-evaluates as its projection changes; when that is, is the scheduler's own test.
		await vi.advanceTimersByTimeAsync(1000);
		expect(clock.value.display).toBe('39:59');

		await vi.advanceTimersByTimeAsync(40 * MINUTE - 1001);
		expect(clock.value).toMatchObject({ state: 'running', display: '0:01' });
		await vi.advanceTimersByTimeAsync(1);
		expect(clock.value).toMatchObject({ state: 'ended', display: '0:00' });
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	// The Screen's count-up setting reaches the projection; its rule is projectRoundClock's own test.
	it('counts up past the end to the Screen\'s limit, then holds', async () => {
		config.countUpAfterEnd = true;
		config.countUpLimitMinutes = 2;
		mockFetch.mockResolvedValue(answer({}));
		const { clock } = makeRoundClockModeData();
		await flushPromises();

		await vi.advanceTimersByTimeAsync(41 * MINUTE);
		expect(clock.value).toMatchObject({ state: 'ended', display: '1:00' });

		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(clock.value).toMatchObject({ state: 'ended', display: '2:00' });
	});

	it('starts counting without a reload when "Start now" announces the Round', async () => {
		config.roundId = 31;
		mockFetch.mockResolvedValue(answer({ startedAt: null }));
		const { clock } = makeRoundClockModeData();
		await flushPromises();
		expect(clock.value).toMatchObject({ state: 'pending', display: '50:00' });

		const startedAt = new Date(Date.now()).toISOString();
		mockFetch.mockResolvedValue(answer({ startedAt }));
		deliver('round:updated', {
			round: { id: 31 } as any,
		});
		await flushPromises();

		expect(clock.value).toMatchObject({ state: 'running', display: '50:00' });
		await vi.advanceTimersByTimeAsync(1000);
		expect(clock.value.display).toBe('49:59');
	});

	// The Round it picks reaches the rule; what a Round Clock follows is `screenOutputInterest`'s own test.
	it.each([
		[
			'a picked Round, another Round\'s update',
			31,
			'round:updated',
			{
				round: { id: 32 },
			},
			false,
		],
		[
			'the Current Round, any Round\'s update',
			undefined,
			'round:updated',
			{
				round: { id: 32 },
			},
			true,
		],
	] as const)('%s: re-reads or not', async (_case, roundId, type, data, rereads) => {
		config.roundId = roundId;
		mockFetch.mockResolvedValue(answer({}));
		makeRoundClockModeData();
		await flushPromises();

		deliver(type, data as any);
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(rereads ? 2 : 1);
	});

	it('is empty with no Round to show', async () => {
		mockFetch.mockResolvedValue(answer(null));

		const { isEmpty } = makeRoundClockModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
	});
});
