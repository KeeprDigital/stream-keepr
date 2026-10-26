import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CounterList from '~/components/FeatureMatch/State/CounterList.vue';

const playerControls = {
	updateCounters: vi.fn(),
};

mockNuxtImport('usePlayerControls', () => () => playerControls);
mockNuxtImport('useEventStore', () => () => ({
	event: { game: 'mtg' },
}));

const CounterItemStub = {
	props: ['counter'],
	emits: ['change', 'reset', 'remove'],
	template: `<div data-testid="counter-item" :data-type="counter.type">
		<button type="button" data-action="decrease" @click="$emit('change', -5)" />
		<button type="button" data-action="reset" @click="$emit('reset')" />
		<button type="button" data-action="remove" @click="$emit('remove')" />
	</div>`,
};

const counters = [
	{ type: 'poison', value: 1 },
	{ type: 'energy', value: 2 },
];

function mountCounterList(props: Record<string, unknown> = {}) {
	return mount(CounterList, {
		props: {
			matchId: 1,
			player: 'player1',
			counters,
			...props,
		},
		global: {
			stubs: { ...nuxtUiStubs, FeatureMatchStateCounterItem: CounterItemStub },
		},
	});
}

async function act(wrapper: ReturnType<typeof mountCounterList>, type: string, action: string) {
	await wrapper.get(`[data-type="${type}"] [data-action="${action}"]`).trigger('click');
	return playerControls.updateCounters.mock.lastCall?.[0];
}

describe('featureMatchCounterList', () => {
	it('never takes a counter below zero', async () => {
		expect(await act(mountCounterList(), 'poison', 'decrease')).toEqual([
			{ type: 'poison', value: 0 },
			{ type: 'energy', value: 2 },
		]);
	});

	it('resets one counter to zero and removes another, leaving the rest', async () => {
		const wrapper = mountCounterList();

		expect(await act(wrapper, 'energy', 'reset')).toEqual([
			{ type: 'poison', value: 1 },
			{ type: 'energy', value: 0 },
		]);
		expect(await act(wrapper, 'poison', 'remove')).toEqual([
			{ type: 'energy', value: 2 },
		]);
	});

	it('offers only the counter types the Player does not already track', async () => {
		const wrapper = mountCounterList({
			counters: [
				{ type: 'energy', value: 2 },
			],
			availableCounterTypes: [
				{ key: 'energy', label: 'Energy', icon: 'i-mdi-lightning-bolt' },
				{ key: 'poison', label: 'Poison', icon: 'i-mdi-skull' },
			],
		});

		await wrapper.get('[aria-label="Add counter"]').trigger('click');
		const offered = wrapper.findAll('button').map(button => button.text()).filter(Boolean);
		expect(offered).toEqual(['Poison']);

		await wrapper.findAll('button').find(button => button.text() === 'Poison')!.trigger('click');
		expect(playerControls.updateCounters).toHaveBeenLastCalledWith([
			{ type: 'energy', value: 2 },
			{ type: 'poison', value: 0 },
		]);
	});

	it('hides adding counters when read-only', () => {
		const wrapper = mountCounterList({ readonly: true });

		expect(wrapper.find('[aria-label="Add counter"]').exists()).toBe(false);
		expect(wrapper.findAll('[data-testid="counter-item"]')).toHaveLength(2);
	});
});
