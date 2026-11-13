import type { Commander, MtgPlayerGameData } from '~~/shared/types/game';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATRAXA, KRAUM, scryfallCardOf, TYMNA } from '~~/test/helpers/commanders';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CommanderFields from '~/components/FeatureMatch/Setup/CommanderFields.vue';

// A Seat's Commander picker (ADR-0087). Scryfall's card search is faked at `$fetch`.

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const SEARCH = 'https://api.scryfall.com/cards/search';
const ATRAXA_2XM: Commander = {
	...ATRAXA,
	scryfallId: '7c9b6f0a-2d5e-4f43-8a39-1e0b6d2c5f77',
	setCode: '2xm',
	collectorNumber: '190',
};

function mountFields(commanders: Commander[] = []) {
	const updates: MtgPlayerGameData[] = [];
	const wrapper = mount(CommanderFields, {
		props: {
			'modelValue': { type: 'mtg', commanders } as MtgPlayerGameData,
			'onUpdate:modelValue': (value: MtgPlayerGameData) => {
				updates.push(value);
				void wrapper.setProps({ modelValue: value });
			},
		},
		global: {
			stubs: { ...nuxtUiStubs, MtgManaColorDisplay: true },
		},
	});
	return { wrapper, updates };
}

type Wrapper = ReturnType<typeof mountFields>['wrapper'];

async function search(wrapper: Wrapper, text: string) {
	const input = wrapper.get('input[aria-label="Search Commanders"]');
	await input.setValue(text);
	await input.trigger('keydown', { key: 'Enter' });
	await flushPromises();
}

async function press(wrapper: Wrapper, label: string) {
	await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
	await flushPromises();
}

function labels(wrapper: Wrapper, list: string) {
	return wrapper.findAll(`ul[aria-label="${list}"] button`).map(button => button.attributes('aria-label'));
}

function held(wrapper: Wrapper) {
	return wrapper.findAll('[data-commander]').map(row => row.attributes('data-printing'));
}

describe('a Seat\'s Commander picker', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({
			data: [
				scryfallCardOf(ATRAXA),
			],
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('searches Magic cards by name and holds the one picked as that printing', async () => {
		const { wrapper, updates } = mountFields();

		await search(wrapper, 'atraxa');

		expect(mockFetch.mock.calls.map(([url, options]) => [url, options.query])).toEqual([
			[
				SEARCH,
				{ q: 'atraxa game:paper', unique: 'cards' },
			],
		]);
		expect(labels(wrapper, 'Cards')).toEqual(['Pick Commander Atraxa, Praetors\' Voice']);

		await press(wrapper, 'Pick Commander Atraxa, Praetors\' Voice');

		expect(updates.at(-1)).toEqual({
			type: 'mtg',
			commanders: [ATRAXA],
		});
		expect(held(wrapper)).toEqual([ATRAXA.scryfallId]);
	});

	it('adds a second Commander beside the first, and then offers no search for a third', async () => {
		mockFetch.mockResolvedValue({
			data: [
				scryfallCardOf(TYMNA),
			],
		});
		const { wrapper, updates } = mountFields([ATRAXA]);

		await search(wrapper, 'tymna');
		await press(wrapper, 'Pick Commander Tymna the Weaver');

		expect(updates.at(-1)?.commanders).toEqual([ATRAXA, TYMNA]);
		expect(wrapper.find('input[aria-label="Search Commanders"]').exists()).toBe(false);
	});

	it('removes a Commander, keeping the other', async () => {
		const { wrapper, updates } = mountFields([TYMNA, KRAUM]);

		await press(wrapper, 'Remove Tymna the Weaver');

		expect(updates.at(-1)?.commanders).toEqual([KRAUM]);
	});

	it('changes a held Commander to another of its printings, in its place', async () => {
		mockFetch.mockResolvedValue({
			data: [
				scryfallCardOf(ATRAXA_2XM),
				scryfallCardOf(ATRAXA),
			],
		});
		const { wrapper, updates } = mountFields([ATRAXA, TYMNA]);

		await press(wrapper, 'Change printing of Atraxa, Praetors\' Voice');

		expect(mockFetch.mock.calls.map(([url, options]) => [url, options.query])).toEqual([
			[
				SEARCH,
				{ q: '!"Atraxa, Praetors\' Voice" game:paper', unique: 'prints', order: 'released' },
			],
		]);
		expect(labels(wrapper, 'Printings of Atraxa, Praetors\' Voice')).toEqual(['Pick printing 2XM 190', 'Pick printing CM2 10']);

		await press(wrapper, 'Pick printing 2XM 190');

		expect(updates.at(-1)?.commanders).toEqual([ATRAXA_2XM, TYMNA]);
		expect(wrapper.find('ul[aria-label="Printings of Atraxa, Praetors\' Voice"]').exists()).toBe(false);
	});

	// Scryfall answers a search that matches nothing with 404.
	it.each([
		{
			answer: 'no card',
			failure: { statusCode: 404 },
			selector: '[data-no-cards]',
		},
		{
			answer: 'a failure',
			failure: { statusCode: 503 },
			selector: '[data-search-failed]',
		},
	])('says so when Scryfall answers $answer', async ({ failure, selector }) => {
		mockFetch.mockRejectedValue(Object.assign(new Error('refused'), failure));
		const { wrapper } = mountFields();

		await search(wrapper, 'zzzz');

		expect(wrapper.find(selector).exists()).toBe(true);
		expect(labels(wrapper, 'Cards')).toEqual([]);
	});

	it.each([
		{ typed: 'two letters', text: 'at', searches: 0 },
		{ typed: 'three letters', text: 'atr', searches: 1 },
	])('searches once the operator pauses after typing $typed: $searches', async ({ text, searches }) => {
		vi.useFakeTimers();
		const { wrapper } = mountFields();

		await wrapper.get('input[aria-label="Search Commanders"]').setValue(text);
		expect(mockFetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(300);

		expect(mockFetch).toHaveBeenCalledTimes(searches);
	});
});
