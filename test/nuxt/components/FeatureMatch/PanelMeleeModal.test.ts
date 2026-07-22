import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';

const mockMatchStore = reactive({
	matches: [
		{ id: 10, tableNumber: 3, player1Data: { name: 'Alice' }, player2Data: { name: 'Bob' } },
	],
});

mockNuxtImport('useMatchStore', () => () => mockMatchStore);

const UModalStub = defineComponent({
	props: {
		open: { type: Boolean, required: false },
	},
	template: '<div v-if="open"><slot name="body" /><slot name="footer" /></div>',
});

const UButtonStub = defineComponent({
	props: {
		disabled: { type: Boolean, required: false },
	},
	setup(props, { attrs, slots }) {
		return () => h('button', {
			disabled: props.disabled,
			onClick: attrs.onClick as ((event: MouseEvent) => void) | undefined,
		}, slots.default?.());
	},
});

const USelectMenuStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
		items: { type: Array, required: true },
	},
	emits: ['update:modelValue'],
	template: `
		<select :value="modelValue" @change="$emit('update:modelValue', Number($event.target.value))">
			<option value="">Select</option>
			<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
		</select>
	`,
});

function fireEnter() {
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

async function mountComponent() {
	const { default: PanelMeleeModal } = await import('~/components/FeatureMatch/PanelMeleeModal.vue');
	return mount(PanelMeleeModal, {
		props: { open: true },
		global: {
			stubs: {
				UModal: UModalStub,
				UButton: UButtonStub,
				USelectMenu: USelectMenuStub,
			},
		},
	});
}

describe('feature match melee populate modal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('populates the selected match on Enter', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('select').setValue('10');
		fireEnter();

		expect(wrapper.emitted('populate')).toEqual([[mockMatchStore.matches[0]]]);
		wrapper.unmount();
	});
});
