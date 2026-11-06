import type { OpPlayerGameData } from '~~/shared/types/game';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LUFFY, opCardSummary, ZORO } from '~~/test/helpers/opCards';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import OpPlayerFields from '~/components/FeatureMatch/Setup/OpPlayerFields.vue';

// A Slot side's Leader picker. The Event's `op-cards` route is faked at `$fetch`.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventStore', () => () => ({ eventId: 7 }));

function mountFields(gameData: OpPlayerGameData = { type: 'op', leader: null }) {
	const updates: OpPlayerGameData[] = [];
	const wrapper = mount(OpPlayerFields, {
		props: {
			'modelValue': gameData,
			'onUpdate:modelValue': (value: OpPlayerGameData) => {
				updates.push(value);
				void wrapper.setProps({ modelValue: value });
			},
		},
		global: { stubs: nuxtUiStubs },
	});
	return { wrapper, updates };
}

async function search(wrapper: ReturnType<typeof mountFields>['wrapper'], text: string) {
	await flushPromises();
	await wrapper.get('input[aria-label="Search Leaders"]').setValue(text);
}

function offeredNames(wrapper: ReturnType<typeof mountFields>['wrapper']) {
	return wrapper.findAll('ul[aria-label="Leaders"] button').map(button => button.attributes('aria-label'));
}

const zoroCard = opCardSummary();
const luffyCard = opCardSummary({
	number: LUFFY.number,
	name: LUFFY.name,
	colors: LUFFY.colors,
	printingId: LUFFY.number,
	imageUrl: LUFFY.imageUrl,
});

describe('a Slot side\'s Leader picker', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({
			available: true,
			items: [
				opCardSummary(),
			],
			total: 1,
		});
	});

	it('loads every Leader once, a page at a time', async () => {
		mockFetch
			.mockResolvedValueOnce({
				available: true,
				items: [zoroCard],
				total: 2,
			})
			.mockResolvedValueOnce({
				available: true,
				items: [luffyCard],
				total: 2,
			});
		const { wrapper } = mountFields();

		await search(wrapper, 'luf');
		await search(wrapper, 'zor');

		expect(mockFetch.mock.calls.map(([path, options]) => [path, options.query])).toEqual([
			[
				'/api/events/7/op-cards',
				{ category: 'leader', limit: 250, offset: 0 },
			],
			[
				'/api/events/7/op-cards',
				{ category: 'leader', limit: 250, offset: 1 },
			],
		]);
		expect(offeredNames(wrapper)).toEqual(['Pick Leader Roronoa Zoro (OP01-001)']);
	});

	it.each([
		[
			'part of a name',
			'luf',
			['Pick Leader Monkey.D.Luffy (OP01-003)'],
		],
		[
			'part of a card number',
			'op01-00',
			['Pick Leader Roronoa Zoro (OP01-001)', 'Pick Leader Monkey.D.Luffy (OP01-003)'],
		],
		['nothing typed', '', []],
	])('offers the Leaders matching %s', async (_case, text, offered) => {
		mockFetch.mockResolvedValue({
			available: true,
			items: [zoroCard, luffyCard],
			total: 2,
		});
		const { wrapper } = mountFields();

		await search(wrapper, text);

		expect(offeredNames(wrapper)).toEqual(offered);
	});

	it('says when no Leader matches', async () => {
		const { wrapper } = mountFields();

		await search(wrapper, 'nami');

		expect(offeredNames(wrapper)).toEqual([]);
		expect(wrapper.get('[data-no-leaders]').text()).toContain('nami');
	});

	it('offers a retry when the Leaders fail to load', async () => {
		mockFetch.mockRejectedValueOnce(new Error('upstream'));
		const { wrapper } = mountFields();
		await flushPromises();

		expect(wrapper.text()).toContain('Leaders could not be loaded');
		const retry = wrapper.findAll('button').find(button => button.text() === 'Retry');
		await retry!.trigger('click');
		await search(wrapper, 'zor');

		expect(offeredNames(wrapper)).toEqual(['Pick Leader Roronoa Zoro (OP01-001)']);
	});

	it('holds the picked Leader as a snapshot of its card', async () => {
		const { wrapper, updates } = mountFields();

		await search(wrapper, 'zoro');
		await wrapper.get('button[aria-label="Pick Leader Roronoa Zoro (OP01-001)"]').trigger('click');

		expect(updates.at(-1)).toEqual({ type: 'op', leader: ZORO });
		expect(wrapper.get('[data-leader]').text()).toContain('Roronoa Zoro');
		expect(wrapper.get('[data-leader] [data-op-colors]').attributes('aria-label')).toBe('Red');
	});

	it('clears the side\'s Leader', async () => {
		const { wrapper, updates } = mountFields({ type: 'op', leader: ZORO });

		await wrapper.get('button[aria-label="Clear Leader"]').trigger('click');

		expect(updates.at(-1)).toEqual({ type: 'op', leader: null });
		expect(wrapper.find('[data-leader]').exists()).toBe(false);
	});

	it('says at once that card data is unavailable, and keeps the Leader it holds', async () => {
		mockFetch.mockResolvedValue({ available: false });
		const { wrapper } = mountFields({ type: 'op', leader: ZORO });

		await flushPromises();

		expect(wrapper.text()).toContain('Card data unavailable');
		expect(wrapper.get('input[aria-label="Search Leaders"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-leader]').text()).toContain('Roronoa Zoro');
	});
});
