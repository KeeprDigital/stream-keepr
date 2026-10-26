import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import ColumnVisibilityList from '~/components/Screen/ColumnVisibilityList.vue';

/**
 * The one draggable column visibility list, shared by the Standings, Player
 * History and Metagame settings: what it shows, and the whole column list it
 * hands back on every reorder or visibility toggle. Persisting it is the host's.
 */

vi.mock('vue-draggable-plus', () => ({
	VueDraggable: defineComponent({
		name: 'VueDraggable',
		props: {
			modelValue: { type: Array, required: false },
		},
		emits: ['update:modelValue', 'end'],
		template: '<div><slot /></div>',
	}),
}));

enableAutoUnmount(afterEach);

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="column-visible" @click="$emit(\'update:modelValue\', !modelValue)">{{ String(!!modelValue) }}</button>',
});

const labels = { position: '#', name: 'Name', deck: 'Deck' };

function columns() {
	return [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'deck', visible: false },
	];
}

function shownRows(wrapper: ReturnType<typeof mountList>) {
	return wrapper.findAll('[data-testid="column-row"]')
		.map(row => `${row.get('[data-testid="column-label"]').text()} ${row.get('[data-testid="column-visible"]').text()}`);
}

function mountList(props: { columns?: Array<{ key: string; visible: boolean }>; labels?: Record<string, string> } = {}) {
	return mount(ColumnVisibilityList, {
		props: { columns: props.columns ?? columns(), labels: props.labels ?? labels },
		global: {
			stubs: { USwitch: USwitchStub, UIcon: true },
		},
	});
}

describe('screenColumnVisibilityList', () => {
	it('names each column by its label, falling back to its key', () => {
		const wrapper = mountList({
			labels: { position: '#', name: 'Name' },
		});

		expect(shownRows(wrapper)).toEqual(['# true', 'Name true', 'deck false']);
	});

	it('hands back the whole list with only the toggled column flipped', async () => {
		const wrapper = mountList();

		await wrapper.findAll('[data-testid="column-visible"]')[2]!.trigger('click');

		expect(wrapper.emitted('update')).toEqual([
			[
				[
					{ key: 'position', visible: true },
					{ key: 'name', visible: true },
					{ key: 'deck', visible: true },
				],
			],
		]);
	});

	it('hands back the reordered list when a drag ends', async () => {
		const wrapper = mountList();
		const reordered = [columns()[2]!, columns()[0]!, columns()[1]!];

		const draggable = wrapper.getComponent({ name: 'VueDraggable' });
		draggable.vm.$emit('update:modelValue', reordered);
		await nextTick();
		draggable.vm.$emit('end');

		expect(wrapper.emitted('update')).toEqual([
			[reordered],
		]);
	});

	it('never touches the columns it was given', async () => {
		const given = columns();
		const wrapper = mountList({ columns: given });

		await wrapper.findAll('[data-testid="column-visible"]')[0]!.trigger('click');

		expect(given).toEqual(columns());
	});

	it('follows the columns it is given', async () => {
		const wrapper = mountList();

		await wrapper.setProps({
			columns: [
				{ key: 'name', visible: false },
				{ key: 'position', visible: true },
			],
		});

		expect(shownRows(wrapper)).toEqual(['Name false', '# true']);
	});
});
