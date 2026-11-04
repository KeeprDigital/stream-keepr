import type { OpUnresolvedDeckCard } from '~~/shared/types/opUnresolvedDeckCard';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { opCardSummary } from '~~/test/helpers/opCards';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import OpUnresolvedDeckCards from '~/components/Op/UnresolvedDeckCards.vue';

// The Cards page's Unresolved Deck Cards on an OP Event: listed Event-wide, retried,
// or resolved to a card picked from a bandai-keepr search. The routes are faked at `$fetch`.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventStore', () => () => ({ eventId: 7 }));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	featureMatches: [
		{ id: 90 },
		{ id: 91 },
	],
}));

const LIST_PATH = '/api/events/7/op-unresolved-deck-cards';

const MISPRINT: OpUnresolvedDeckCard = {
	number: 'OP91-040',
	copies: 5,
	deckLists: [
		{
			holder: { kind: 'player', playerId: 4, name: 'ana' },
			quantity: 4,
			asLeader: false,
		},
		{
			holder: {
				kind: 'slotSide',
				slotId: 91,
				side: 'player2',
				name: 'Cora',
			},
			quantity: 1,
			asLeader: false,
		},
	],
};
const UNKNOWN_LEADER: OpUnresolvedDeckCard = {
	number: 'OP13-097',
	copies: 1,
	deckLists: [
		{
			holder: { kind: 'player', playerId: 5, name: 'ben' },
			quantity: 1,
			asLeader: true,
		},
	],
};

let listed: OpUnresolvedDeckCard[] = [];
let searched: unknown = { available: true, items: [], total: 0 };

function route(path: string, options?: { method?: string; body?: unknown; query?: unknown }) {
	if (path === LIST_PATH)
		return Promise.resolve(listed);
	if (path === '/api/events/7/op-cards')
		return Promise.resolve(searched);
	throw new Error(`unexpected ${options?.method ?? 'GET'} ${path}`);
}

function mountList() {
	return mount(OpUnresolvedDeckCards, {
		global: { stubs: nuxtUiStubs },
	});
}

function row(wrapper: ReturnType<typeof mountList>, number: string) {
	return wrapper.get(`[data-unresolved-number="${number}"]`);
}

describe('an OP Event\'s Unresolved Deck Cards', () => {
	beforeEach(() => {
		listed = [MISPRINT, UNKNOWN_LEADER];
		searched = { available: true, items: [], total: 0 };
		mockFetch.mockReset();
		mockFetch.mockImplementation(route);
	});

	it('lists each number with the Deck Lists holding it and their copies', async () => {
		const wrapper = mountList();
		await flushPromises();

		expect(row(wrapper, 'OP91-040').get('[data-copies]').text()).toContain('5');
		expect(row(wrapper, 'OP91-040').findAll('[data-holder]').map(holder => holder.text())).toEqual([
			'4x ana',
			'1x Feature Match 2: Cora',
		]);
		expect(row(wrapper, 'OP13-097').get('[data-holder]').attributes('data-as-leader')).toBe('true');
	});

	it.each([
		['still unknown, so the list stays', null, 2],
		[
			'now known, so it leaves the list',
			{ number: 'OP91-040', name: 'Usopp' },
			1,
		],
	])('retries a number through the bulk lookup: %s', async (_case, card, remaining) => {
		const wrapper = mountList();
		await flushPromises();
		const retrying = deferred<unknown>();
		mockFetch.mockImplementation((path: string, options?: { method?: string }) => options?.method === 'POST'
			? retrying.promise
			: route(path, options));

		await row(wrapper, 'OP91-040').get('button[aria-label="Retry OP91-040"]').trigger('click');
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith(`${LIST_PATH}/OP91-040/retry`, expect.objectContaining({ method: 'POST' }));
		expect(row(wrapper, 'OP91-040').get('button[aria-label="Retry OP91-040"]').attributes('aria-busy')).toBe('true');

		if (card)
			listed = [UNKNOWN_LEADER];
		retrying.resolve({
			number: 'OP91-040',
			card,
			rewritten: card ? 2 : 0,
		});
		await flushPromises();

		expect(wrapper.findAll('[data-unresolved-number]')).toHaveLength(remaining);
	});

	it('resolves a number to a card picked from a bandai-keepr search, and leaves the list', async () => {
		searched = {
			available: true,
			items: [
				opCardSummary({ number: 'OP01-040', name: 'Usopp', category: 'character' }),
			],
			total: 1,
		};
		const wrapper = mountList();
		await flushPromises();

		await row(wrapper, 'OP91-040').get('button[aria-label="Resolve OP91-040"]').trigger('click');
		await wrapper.get('input[aria-label="Search bandai-keepr"]').setValue('Usopp');
		await wrapper.get('form[aria-label="Search bandai-keepr for OP91-040"]').trigger('submit');
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/events/7/op-cards', expect.objectContaining({
			query: { q: 'Usopp' },
		}));
		const resolving = deferred<unknown>();
		mockFetch.mockImplementation((path: string, options?: { method?: string }) => options?.method === 'PUT'
			? resolving.promise
			: route(path, options));
		await wrapper.get('button[aria-label="Resolve OP91-040 to OP01-040"]').trigger('click');
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith(`${LIST_PATH}/OP91-040`, expect.objectContaining({
			method: 'PUT',
			body: { cardNumber: 'OP01-040' },
		}));
		expect(wrapper.get('button[aria-label="Resolve OP91-040 to OP01-040"]').attributes('aria-busy')).toBe('true');

		listed = [UNKNOWN_LEADER];
		resolving.resolve({
			number: 'OP91-040',
			card: { number: 'OP01-040', name: 'Usopp' },
			rewritten: 2,
		});
		await flushPromises();

		expect(wrapper.findAll('[data-unresolved-number]').map(item => item.attributes('data-unresolved-number'))).toEqual(['OP13-097']);
	});

	it.each([
		[
			'a card number',
			'op01-040',
			{ number: 'OP01-040' },
		],
		[
			'a name',
			'Usopp',
			{ q: 'Usopp' },
		],
	])('searches bandai-keepr by %s', async (_case, term, query) => {
		const wrapper = mountList();
		await flushPromises();

		await row(wrapper, 'OP91-040').get('button[aria-label="Resolve OP91-040"]').trigger('click');
		await wrapper.get('input[aria-label="Search bandai-keepr"]').setValue(term);
		await wrapper.get('form[aria-label="Search bandai-keepr for OP91-040"]').trigger('submit');
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/events/7/op-cards', expect.objectContaining({ query }));
	});

	it('says card data is unavailable when no bandai-keepr is configured', async () => {
		searched = { available: false };
		const wrapper = mountList();
		await flushPromises();

		await row(wrapper, 'OP91-040').get('button[aria-label="Resolve OP91-040"]').trigger('click');
		await wrapper.get('input[aria-label="Search bandai-keepr"]').setValue('Usopp');
		await wrapper.get('form[aria-label="Search bandai-keepr for OP91-040"]').trigger('submit');
		await flushPromises();

		expect(wrapper.find('[data-search-unavailable]').exists()).toBe(true);
	});
});
