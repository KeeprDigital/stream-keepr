import type { PropType } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent, createMockRound } from '~~/test/helpers/fixtures';

/*
 * The Event Structure page over the real Melee, Round and sibling stores. Faked:
 * the Event repository, `$fetch`, the confirm modal and the toast the operator reads.
 */

const mockEventRepo = {
	getById: vi.fn(),
	syncSpecificRound: vi.fn(),
};
const mockToast = {
	add: vi.fn(),
};
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));

mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: () => ({
			result: Promise.resolve(true),
		}),
	}),
}));

const round = createMockRound({
	id: 10,
	eventId: 1,
	phaseId: 1,
	name: 'Round 1',
});

/** The server stores every write and answers every read, but the Rounds when they are offline. */
function serve({ rounds }: { rounds: 'online' | 'offline' }) {
	mockFetch.mockImplementation(async (path: string, options?: { method?: string }) => {
		if (options?.method === 'POST')
			return {};
		if (!path.endsWith('/rounds'))
			return [];
		if (rounds === 'offline')
			throw new Error('rounds offline');
		return [round];
	});
}

/** Each Round as the two actions this page starts for it, and whether the page is still loading. */
const PhaseListStub = defineComponent({
	props: {
		rounds: {
			type: Array as PropType<Array<{ id: number }>>,
			default: () => [],
		},
		loading: Boolean,
	},
	emits: ['syncMatches', 'enableManualOverride'],
	template: `<div :data-loading="loading">
		<template v-for="round in rounds" :key="round.id">
			<button type="button" :data-sync="round.id" @click="$emit('syncMatches', round)" />
			<button type="button" :data-override="round.id" @click="$emit('enableManualOverride', round)" />
		</template>
	</div>`,
});

async function mountPage() {
	const pagePath = '../../../../../app/pages/event/[eventId]/rounds.vue';
	const { default: RoundsPage } = await import(pagePath);
	return mount(RoundsPage, {
		global: {
			stubs: {
				UICollectionPage: defineComponent({ template: '<div><slot /></div>' }),
				RoundPhaseList: PhaseListStub,
				UIInitialLoadError: defineComponent({ template: '<div role="alert" />' }),
			},
		},
	});
}

let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

beforeEach(() => {
	for (const store of [
		useMeleeStore(),
		useEventStore(),
		usePhaseStore(),
		useRoundStore(),
		useMatchStore(),
		usePlayerStore(),
		useFeatureMatchStore(),
		useFeatureMatchStateStore(),
		useMetagameStore(),
	])
		store.$reset();
	const event = {
		...createMockEvent(),
		talents: [],
		meleeConfigured: false,
	};
	useEventStore().setEvent(event as never);
	mockEventRepo.getById.mockResolvedValue(event);
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
});

describe('event structure page, when a newer Rounds load supersedes its own', () => {
	// Its own read answers after a reload a realtime message started, so it holds nothing.
	it('keeps loading, with no error, until the newer load lands, then shows that load\'s Rounds', async () => {
		const reads = [
			deferred<unknown>(),
			deferred<unknown>(),
		];
		const [pageRead, newerRead] = reads;
		mockFetch.mockImplementation(async (path: string) => path.endsWith('/rounds')
			? reads.shift()!.promise
			: []);
		wrapper = await mountPage();
		await flushPromises();
		const newerLoad = useRoundStore().loadRoundsByEventId(1);

		pageRead!.resolve([round]);
		await flushPromises();

		expect(wrapper.find('[role="alert"]').exists()).toBe(false);
		expect(wrapper.get('[data-loading]').attributes('data-loading')).toBe('true');

		newerRead!.resolve([
			createMockRound({
				id: 11,
				eventId: 1,
				phaseId: 1,
				name: 'Round 2',
			}),
		]);
		await newerLoad;
		await flushPromises();

		expect(wrapper.find('[role="alert"]').exists()).toBe(false);
		expect(wrapper.get('[data-loading]').attributes('data-loading')).toBe('false');
		expect(wrapper.findAll('[data-sync]').map(button => button.attributes('data-sync'))).toEqual(['11']);
	});
});

describe('event structure page, when the reload after a committed write fails', () => {
	beforeEach(async () => {
		mockEventRepo.syncSpecificRound.mockResolvedValue({
			success: true,
			round,
			matchCount: 1,
			created: 1,
			updated: 0,
			warnings: [],
		});
		serve({ rounds: 'online' });
		await useRoundStore().loadRoundsByEventId(1);
		mockToast.add.mockClear();
	});

	// The write landed either way; only what the operator is told to do next differs.
	it.each([
		{
			action: 'sync',
			rounds: 'offline',
			title: 'Round Synced — Reload Needed',
			color: 'warning',
		},
		{
			action: 'sync',
			rounds: 'online',
			title: 'Round Synced',
			color: 'success',
		},
		{
			action: 'override',
			rounds: 'offline',
			title: 'Manual Override Enabled — Reload Needed',
			color: 'warning',
		},
		{
			action: 'override',
			rounds: 'online',
			title: 'Manual Override Enabled',
			color: 'success',
		},
	] as const)('a Round $action with the Rounds $rounds says "$title"', async ({ action, rounds, title, color }) => {
		wrapper = await mountPage();
		serve({ rounds });

		await wrapper.get(`[data-${action}="10"]`).trigger('click');
		await flushPromises();

		expect(mockToast.add.mock.calls.map(([toast]) => [toast.title, toast.color])).toEqual([
			[title, color],
		]);
	});
});
