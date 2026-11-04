import type { Deferred } from '~~/test/helpers/deferred';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

const { mockFetch, toast } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	toast: {
		add: vi.fn(),
	},
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useToast', () => () => toast);
mockNuxtImport('useRoute', () => () => reactive({
	path: '/event/3/metagame',
	params: { eventId: '3' },
	query: {},
}));

const stubs = {
	...nuxtUiStubs,
	NuxtLayout: { template: '<div><slot name="toolbar" /><slot /></div>' },
	UDashboardToolbar: { template: '<div><slot name="left" /><slot name="right" /></div>' },
	UNavigationMenu: true,
	MetagameScopeControl: true,
	NuxtPage: true,
};

async function mountPage() {
	const { default: MetagamePage } = await import('~/pages/event/[eventId]/metagame.vue');
	const wrapper = mount(MetagamePage, {
		global: { stubs },
	});
	await flushPromises();
	return wrapper;
}

function conversionSelect(wrapper: Awaited<ReturnType<typeof mountPage>>) {
	return wrapper.get<HTMLSelectElement>('select[aria-label="Conversion target"]');
}

// The page's conversion control writes the Event's Conversion Target (ADR-0061).
describe('the Metagame page\'s conversion control', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		toast.add.mockReset();
		useEventStore().setEvent({
			...createMockEvent({ id: 3, conversionMetric: 'topN', conversionThreshold: 8 }),
			talents: [],
			meleeConfigured: false,
		});
	});

	it.each([
		{
			outcome: 'stored',
			settle: (patch: Deferred<unknown>) => patch.resolve({
				...createMockEvent({ id: 3, conversionMetric: 'topN', conversionThreshold: 16 }),
				talents: [],
				meleeConfigured: false,
			}),
			shown: 'topN:16',
			toasts: 0,
		},
		{
			outcome: 'refused',
			settle: (patch: Deferred<unknown>) => patch.reject(new Error('Event not found')),
			shown: 'topN:8',
			toasts: 1,
		},
	])('writes the Event\'s target, showing it while pending, and holds what the write leaves once $outcome', async ({ settle, shown, toasts }) => {
		const patch = deferred<unknown>();
		mockFetch.mockImplementation((url: string, options?: { method?: string }) =>
			options?.method === 'PATCH'
				? patch.promise
				: Promise.resolve([]));
		const wrapper = await mountPage();

		await conversionSelect(wrapper).setValue('topN:16');

		expect(mockFetch).toHaveBeenCalledWith('/api/events/3', expect.objectContaining({
			method: 'PATCH',
			body: { conversionMetric: 'topN', conversionThreshold: 16 },
		}));
		expect(conversionSelect(wrapper).element.value).toBe('topN:16');

		settle(patch);
		await flushPromises();

		expect(conversionSelect(wrapper).element.value).toBe(shown);
		expect(toast.add).toHaveBeenCalledTimes(toasts);
		wrapper.unmount();
	});
});

// An OP Metagame reads participation only: every Player or a Player List, and no Conversion Target (ADR-0074).
describe('the Metagame page on each Card Game', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		usePlayerListStore().$reset();
	});

	async function mountFor(game: 'mtg' | 'op') {
		useEventStore().setEvent({
			...createMockEvent({ id: 3, game }),
			talents: [],
			meleeConfigured: false,
		});
		mockFetch.mockImplementation((url: string) => Promise.resolve(url.endsWith('/player-lists')
			? [
					{ id: 4, name: 'Day 2', memberCount: 12 },
				]
			: []));
		const { default: MetagamePage } = await import('~/pages/event/[eventId]/metagame.vue');
		const wrapper = mount(MetagamePage, {
			global: {
				stubs: {
					...stubs,
					MetagameScopeControl: false,
					UNavigationMenu: {
						props: ['items'],
						template: '<nav data-testid="tabs">{{ items.map(item => item.label).join("|") }}</nav>',
					},
				},
			},
		});
		await flushPromises();
		return wrapper;
	}

	it.each([
		[
			'mtg',
			'Archetypes|Cards|Tokens',
			true,
			[
				'All Players',
				'Top 8',
				'Top 16',
				'Top 32',
				'Top N…',
				'Minimum Points…',
				'Day 2 (12)',
			],
		],
		[
			'op',
			'Archetypes|Cards',
			false,
			['All Players', 'Day 2 (12)'],
		],
	] as const)('on a %s Event, offers the tabs %s, a Conversion Target: %s, and the scopes %j', async (game, tabs, conversion, scopes) => {
		const wrapper = await mountFor(game);

		expect(wrapper.get('[data-testid="tabs"]').text()).toBe(tabs);
		expect(wrapper.find('select[aria-label="Conversion target"]').exists()).toBe(conversion);
		const scope = wrapper.findAll('select').find(select => select.attributes('aria-label') !== 'Conversion target')!;
		expect(scope.findAll('option').map(option => option.text())).toEqual(scopes);
		wrapper.unmount();
	});
});
