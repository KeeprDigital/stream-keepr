import type { MeleeLiveResultsStatusResponse } from '~~/shared/api';
import type { Event } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent, toWire } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import LiveResultsCard from '~/components/Sync/LiveResultsCard.vue';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const TWO_MINUTES_AGO = new Date('2026-10-27T11:58:00.000Z');

const mockEventRepo = {
	setMeleeLiveResults: vi.fn(),
	getMeleeLiveResultsStatus: vi.fn(),
};
const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('useToast', () => () => mockToast);

enableAutoUnmount(afterEach);

type LiveResultsFields = Pick<Event, 'meleeLiveResultsEnabled' | 'meleeLiveResultsError' | 'meleeLiveResultsStopReason' | 'meleeLiveResultsLastCheckedAt'>;

function wireEvent(fields: Partial<LiveResultsFields> = {}): Event {
	return {
		...toWire(createMockEvent({ meleeEnabled: true, ...fields } as never)),
		meleeConfigured: true,
		talents: [],
	} as unknown as Event;
}

function status(overrides: Partial<MeleeLiveResultsStatusResponse> = {}): MeleeLiveResultsStatusResponse {
	return {
		enabled: true,
		currentRound: {
			id: 4,
			name: 'Round 4',
			phaseId: 1,
			phaseName: 'Swiss',
		},
		lastCheckedAt: TWO_MINUTES_AGO,
		lastChangeAt: TWO_MINUTES_AGO,
		error: null,
		stopReason: null,
		...overrides,
	};
}

async function mountCard(fields: Partial<LiveResultsFields> = {}) {
	useEventStore().setEvent(wireEvent(fields));
	const wrapper = mount(LiveResultsCard, {
		global: { stubs: nuxtUiStubs },
	});
	await flushPromises();
	return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountCard>>;

const card = (wrapper: Wrapper) => wrapper.get('[data-live-results]');
const liveResultsSwitch = (wrapper: Wrapper) => wrapper.get('[role="switch"]');

describe('live Results card', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		useEventStore().$reset();
		useMeleeStore().$reset();
		mockEventRepo.setMeleeLiveResults.mockReset();
		mockEventRepo.getMeleeLiveResultsStatus.mockReset().mockResolvedValue(status());
		mockToast.add.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each([
		{
			name: 'off',
			fields: {},
			state: 'off',
			checked: 'false',
			shows: [],
			hides: ['Round 4', 'Checked', 'Live Results stopped'],
		},
		{
			name: 'on, with the Current Round, last check and Live Results error',
			fields: { meleeLiveResultsEnabled: true, meleeLiveResultsError: 'Melee.gg answered 500' },
			state: 'on',
			checked: 'true',
			shows: ['Swiss - Round 4', 'Checked 2 minutes ago', 'Melee.gg answered 500'],
			hides: ['Live Results stopped'],
		},
		{
			name: 'stopped after 12 hours with no change',
			fields: { meleeLiveResultsStopReason: 'idle' },
			state: 'stopped',
			checked: 'false',
			shows: ['Live Results stopped: no changes for 12 hours'],
			hides: ['Round 4'],
		},
		{
			name: 'stopped when Melee.gg refused the credentials',
			fields: { meleeLiveResultsStopReason: 'auth' },
			state: 'stopped',
			checked: 'false',
			shows: ['Live Results stopped: Melee.gg rejected the credentials'],
			hides: ['Round 4'],
		},
	] as const)('shows Live Results $name', async ({ fields, state, checked, shows, hides }) => {
		const wrapper = await mountCard(fields);

		expect(card(wrapper).attributes('data-live-results')).toBe(state);
		expect(liveResultsSwitch(wrapper).attributes('aria-checked')).toBe(checked);
		expect(liveResultsSwitch(wrapper).text()).toBe('Live Results');
		for (const text of shows)
			expect(wrapper.text()).toContain(text);
		for (const text of hides)
			expect(wrapper.text()).not.toContain(text);
	});

	it.each([
		{
			from: 'off',
			fields: {},
			enabled: true,
			pending: 'on',
		},
		{
			from: 'on',
			fields: { meleeLiveResultsEnabled: true },
			enabled: false,
			pending: 'off',
		},
		{
			from: 'stopped',
			fields: { meleeLiveResultsStopReason: 'auth' },
			enabled: true,
			pending: 'on',
		},
	] as const)('switches Live Results from $from while the request is pending', async ({ fields, enabled, pending }) => {
		const request = deferred<Event>();
		mockEventRepo.setMeleeLiveResults.mockReturnValue(request.promise);
		const wrapper = await mountCard(fields);

		await liveResultsSwitch(wrapper).trigger('click');

		expect(mockEventRepo.setMeleeLiveResults).toHaveBeenCalledWith(1, enabled);
		expect(card(wrapper).attributes('data-live-results')).toBe(pending);
		expect(liveResultsSwitch(wrapper).attributes('aria-checked')).toBe(String(enabled));

		request.resolve(wireEvent({ meleeLiveResultsEnabled: enabled }));
		await flushPromises();

		expect(card(wrapper).attributes('data-live-results')).toBe(pending);
	});

	it.each([
		{ from: 'off', fields: {}, state: 'off' },
		{
			from: 'stopped',
			fields: { meleeLiveResultsStopReason: 'idle' },
			state: 'stopped',
		},
	] as const)('reverts a refused switch from $from and says why', async ({ fields, state }) => {
		mockEventRepo.setMeleeLiveResults.mockRejectedValue(transportFailure({
			status: 400,
			request: '[PUT] "/api/events/1/melee/live-results"',
			body: {
				statusCode: 400,
				message: 'Turn Melee Sync on before turning Live Results on',
				data: { code: 'MELEE_SYNC_DISABLED' },
			},
		}));
		const wrapper = await mountCard(fields);

		await liveResultsSwitch(wrapper).trigger('click');
		await flushPromises();

		expect(card(wrapper).attributes('data-live-results')).toBe(state);
		expect(liveResultsSwitch(wrapper).attributes('aria-checked')).toBe('false');
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			color: 'error',
			description: 'Turn Melee Sync on before turning Live Results on',
		}));
	});

	it('re-reads the status every 30 seconds while on', async () => {
		const wrapper = await mountCard({ meleeLiveResultsEnabled: true });
		mockEventRepo.getMeleeLiveResultsStatus.mockResolvedValue(status({
			currentRound: {
				id: 5,
				name: 'Quarterfinals',
				phaseId: 2,
				phaseName: null,
			},
			lastCheckedAt: NOW,
		}));

		await vi.advanceTimersByTimeAsync(29_000);
		expect(wrapper.text()).toContain('Swiss - Round 4');

		await vi.advanceTimersByTimeAsync(1_000);
		await flushPromises();
		expect(wrapper.text()).toContain('Quarterfinals');
		expect(wrapper.text()).not.toContain('Swiss');
		expect(wrapper.text()).toContain('Checked just now');
	});

	it.each([
		{ name: 'off', fields: {} },
		{
			name: 'stopped',
			fields: { meleeLiveResultsStopReason: 'idle' },
		},
	] as const)('reads no status while $name', async ({ fields }) => {
		await mountCard(fields);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(mockEventRepo.getMeleeLiveResultsStatus).not.toHaveBeenCalled();
	});
});
