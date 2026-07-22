import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const mockPlayerControls = {
	updateCounters: vi.fn(),
};

mockNuxtImport('usePlayerControls', () => () => mockPlayerControls);
mockNuxtImport('useEventStore', () => () => ({
	event: { game: 'mtg' },
}));

const CounterItemStub = defineComponent({
	template: '<div data-testid="counter-item" />',
});

const UPopoverStub = defineComponent({
	template: '<div :class="$attrs.class"><slot /><slot name="content" /></div>',
});

const UButtonStub = defineComponent({
	props: {
		size: { type: String, required: false },
		icon: { type: String, required: false },
	},
	template: '<button :class="$attrs.class" :data-size="size" :data-icon="icon"><slot /></button>',
});

async function mountComponent(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../../app/components/FeatureMatch/State/' + 'CounterList.vue';
	const { default: CounterList } = await import(componentPath);

	return mount(CounterList, {
		props: {
			matchId: 1,
			player: 'player1',
			counters: [
				{ type: 'poison', value: 1 },
				{ type: 'energy', value: 2 },
				{ type: 'experience', value: 3 },
			],
			...props,
		},
		global: {
			stubs: {
				FeatureMatchStateCounterItem: CounterItemStub,
				UPopover: UPopoverStub,
				UButton: UButtonStub,
			},
		},
	});
}

describe('featureMatchCounterList', () => {
	it('supports three touch columns when requested', async () => {
		const wrapper = await mountComponent({ touch: true, touchColumns: 3 });

		expect(wrapper.classes()).toContain('grid-cols-3');
		expect(wrapper.classes()).toContain('gap-3');
		expect(wrapper.findAll('[data-testid="counter-item"]')).toHaveLength(3);

		const addPopover = wrapper.findComponent(UPopoverStub);
		expect(addPopover.classes()).toContain('col-span-full');
		expect(addPopover.classes()).toContain('justify-self-center');
	});

	it('hides add-counter affordances in readonly mode', async () => {
		const wrapper = await mountComponent({ readonly: true });

		expect(wrapper.findComponent(UPopoverStub).exists()).toBe(false);
		expect(wrapper.findAll('[data-testid="counter-item"]')).toHaveLength(3);
	});

	it('uses derived available counter types when provided', async () => {
		const wrapper = await mountComponent({
			counters: [{ type: 'energy', value: 2 }],
			availableCounterTypes: [
				{ key: 'energy', label: 'Energy', icon: 'i-mdi-lightning-bolt' },
				{ key: 'poison', label: 'Poison', icon: 'i-mdi-skull' },
			],
		});

		const buttons = wrapper.findAll('button');
		expect(buttons.map(button => button.text())).toContain('Poison');
		expect(buttons.map(button => button.text())).not.toContain('Storm');
	});
});
