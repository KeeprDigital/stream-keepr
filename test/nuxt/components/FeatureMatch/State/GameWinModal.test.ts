import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';

const UModalStub = defineComponent({
	props: {
		open: { type: Boolean, required: false },
	},
	template: '<div v-if="open"><slot name="body" /><slot name="footer" /></div>',
});

const UButtonStub = defineComponent({
	setup(_, { attrs, slots }) {
		return () => h('button', {
			onClick: attrs.onClick as ((event: MouseEvent) => void) | undefined,
		}, slots.default?.());
	},
});

const UCheckboxStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)">',
});

function fireEnter() {
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('feature match game win modal', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('confirms the primary action on Enter when open', async () => {
		const { default: GameWinModal } = await import('~/components/FeatureMatch/State/GameWinModal.vue');
		const wrapper = mount(GameWinModal, {
			props: {
				open: true,
				mode: 'win',
				playerName: 'Alice',
				currentGame: 1,
			},
			global: {
				stubs: {
					UModal: UModalStub,
					UButton: UButtonStub,
					UCheckbox: UCheckboxStub,
				},
			},
		});

		fireEnter();

		expect(wrapper.emitted('confirm')).toEqual([[{ resetLife: true, resetCounters: true }]]);
		expect(wrapper.emitted('update:open')).toEqual([[false]]);
		wrapper.unmount();
	});

	it('ignores Enter when closed', async () => {
		const { default: GameWinModal } = await import('~/components/FeatureMatch/State/GameWinModal.vue');
		const wrapper = mount(GameWinModal, {
			props: {
				open: false,
				mode: 'win',
				playerName: 'Alice',
				currentGame: 1,
			},
			global: {
				stubs: {
					UModal: UModalStub,
					UButton: UButtonStub,
					UCheckbox: UCheckboxStub,
				},
			},
		});

		fireEnter();

		expect(wrapper.emitted('confirm')).toBeUndefined();
		wrapper.unmount();
	});
});
