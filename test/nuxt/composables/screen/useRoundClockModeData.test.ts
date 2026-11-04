import type { EffectScope } from 'vue';
import type { ScreenOutputRoundClockResponse, ScreenOutputRoundClockRound } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';

const config = reactive({ roundId: undefined as number | undefined, showRoundName: true });
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;
const serverTimeOffset = ref(0);

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('useScreenModeConfig', () => () => computed(() => config));
// The shared clock, faked: server time is this browser's, plus an offset a sync may move.
mockNuxtImport('useServerTime', () => () => ({
	serverTimeOffset,
	getServerTime: () => Date.now() + serverTimeOffset.value,
}));

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
		serverTimeOffset.value = 0;
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

		await vi.advanceTimersByTimeAsync(1000);
		expect(clock.value.display).toBe('39:59');

		await vi.advanceTimersByTimeAsync(40 * MINUTE);
		expect(clock.value).toMatchObject({ state: 'ended', display: '0:00' });
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('follows a server time sync', async () => {
		mockFetch.mockResolvedValue(answer({}));
		const { clock } = makeRoundClockModeData();
		await flushPromises();

		serverTimeOffset.value = 5 * MINUTE;
		await nextTick();

		expect(clock.value.display).toBe('35:00');
	});

	// Further off than one timer can wait (2^31 - 1 ms), it waits in steps rather than spinning.
	it('waits for a start weeks ahead, then counts from it', async () => {
		const day = 24 * 60 * MINUTE;
		mockFetch.mockResolvedValue(answer({
			startedAt: new Date(Date.now() + 30 * day).toISOString(),
		}));
		const getServerTimeCalls = vi.spyOn(Date, 'now');
		const { clock } = makeRoundClockModeData();
		await flushPromises();

		getServerTimeCalls.mockClear();
		await vi.advanceTimersByTimeAsync(1000);
		expect(getServerTimeCalls.mock.calls.length).toBeLessThan(5);
		expect(clock.value.state).toBe('pending');

		await vi.advanceTimersByTimeAsync(30 * day);
		expect(clock.value).toMatchObject({ state: 'running', display: '49:59' });
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
			'a picked Round, its own update',
			31,
			'round:updated',
			{
				round: { id: 31 },
			},
			true,
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
		[
			'the Current Round, new pairings',
			undefined,
			'melee:pairingsSynced',
			{ roundId: 32 },
			true,
		],
		[
			'a picked Round, new pairings',
			31,
			'melee:pairingsSynced',
			{ roundId: 32 },
			false,
		],
		// Deleting a Round's only Melee Match can move the Current Round back.
		[
			'the Current Round, a deleted Match',
			undefined,
			'match:deleted',
			{ matchId: 5 },
			true,
		],
		[
			'a picked Round, a deleted Match',
			31,
			'match:deleted',
			{ matchId: 5 },
			false,
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
