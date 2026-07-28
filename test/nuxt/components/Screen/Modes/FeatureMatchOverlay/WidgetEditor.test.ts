import type { FeatureMatchWidgetConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<label data-testid="form-field"><span>{{ label }}</span><slot /></label>',
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: [String, Number, Boolean], required: false },
		items: { type: Array, required: false },
		valueKey: { type: String, required: false, default: 'value' },
	},
	emits: ['update:modelValue'],
	template: `
		<div data-testid="u-select">
			<button
				v-for="item in items || []"
				:key="String(item[valueKey] ?? item)"
				type="button"
				:data-value="String(item[valueKey] ?? item)"
				@click="$emit('update:modelValue', item[valueKey] ?? item)"
			>{{ item.label ?? item }}</button>
		</div>
	`,
});

const UInputNumberStub = defineComponent({
	props: {
		modelValue: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="u-input-number" type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
});

const UTextareaStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<textarea data-testid="u-textarea" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const UButtonStub = defineComponent({
	props: {
		icon: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button data-testid="u-button" type="button" :data-icon="icon" @click="$emit(\'click\', $event)"><slot /></button>',
});

const GraphicsAssetFocusPickerStub = defineComponent({
	emits: ['update:modelValue', 'select'],
	setup(_, { emit }) {
		const reference = {
			assetId: 'video-asset',
			revisionId: 'video-revision-4',
		};
		const asset = {
			id: reference.assetId,
			revisionId: reference.revisionId,
			kind: 'silent-video',
			facts: {
				kind: 'silent-video',
				targetCompatibility: 'all-supported',
			},
		};
		return {
			select: () => {
				emit('update:modelValue', reference);
				emit('select', asset, reference);
			},
		};
	},
	template: '<button data-testid="select-media" type="button" @click="select">Select media</button>',
});

async function mountComponent(widget: FeatureMatchWidgetConfig) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/WidgetEditor.vue';
	const { default: WidgetEditor } = await import(componentPath);

	return mount(WidgetEditor, {
		props: { widget, eventId: 7 },
		global: {
			stubs: {
				UButton: UButtonStub,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UInputNumber: UInputNumberStub,
				UTextarea: UTextareaStub,
				GraphicsAssetFocusPicker: GraphicsAssetFocusPickerStub,
			},
		},
	});
}

describe('featureMatchOverlayWidgetEditor', () => {
	it('adds spacer tokens and edits spacer width for text widgets', async () => {
		const wrapper = await mountComponent({
			type: 'text',
			playerSide: 'player1',
			template: '{name}',
		});

		expect(wrapper.text()).toContain('Spacer width');

		const spacerButton = wrapper.findAll('[data-testid="u-button"]').find(button => button.text().includes('Spacer'));
		await spacerButton!.trigger('click');

		expect(wrapper.emitted('update')?.at(-1)?.[0]).toMatchObject({ template: '{name}{spacer}' });

		await wrapper.setProps({ widget: { type: 'text', playerSide: 'player1', template: '{name}{spacer}' } });
		const recordButton = wrapper.findAll('[data-testid="u-button"]').find(button => button.text().includes('{record}'));
		await recordButton!.trigger('click');

		expect(wrapper.emitted('update')?.at(-1)?.[0]).toMatchObject({ template: '{name}{spacer}{record}' });

		await wrapper.get('[data-testid="u-input-number"]').setValue('48');

		expect(wrapper.emitted('update')?.at(-1)?.[0]).toMatchObject({ spacerWidth: 48 });
	});

	it('edits game-win box gap and border width as widget content settings', async () => {
		const wrapper = await mountComponent({
			type: 'game-wins',
			playerSide: 'player1',
			displayMode: 'boxes',
			boxOrientation: 'horizontal',
			boxWidth: 22,
			boxHeight: 22,
			boxGap: 6,
			boxBorderWidth: 2,
		});

		expect(wrapper.text()).toContain('Box gap');
		expect(wrapper.text()).toContain('Box border width');

		const inputs = wrapper.findAll('[data-testid="u-input-number"]');
		await inputs[2]!.setValue('11');
		await inputs[3]!.setValue('5');

		expect(wrapper.emitted('update')?.at(-2)?.[0]).toMatchObject({ boxGap: 11 });
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toMatchObject({ boxBorderWidth: 5 });
	});

	it('shows legacy game-win gap and border width from the widget surface style', async () => {
		const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/WidgetEditor.vue';
		const { default: WidgetEditor } = await import(componentPath);
		const wrapper = mount(WidgetEditor, {
			props: {
				widget: {
					type: 'game-wins',
					playerSide: 'player1',
					displayMode: 'boxes',
					boxOrientation: 'horizontal',
					boxWidth: 22,
					boxHeight: 22,
				},
				widgetSurfaceStyle: {
					padding: 4,
					borderWidth: 3,
				},
				eventId: 7,
			},
			global: {
				stubs: {
					UButton: UButtonStub,
					UFormField: UFormFieldStub,
					USelect: USelectStub,
					UInputNumber: UInputNumberStub,
					UTextarea: UTextareaStub,
					GraphicsAssetFocusPicker: GraphicsAssetFocusPickerStub,
				},
			},
		});

		const inputs = wrapper.findAll('[data-testid="u-input-number"]');
		expect((inputs[2]!.element as HTMLInputElement).value).toBe('4');
		expect((inputs[3]!.element as HTMLInputElement).value).toBe('3');
	});

	it('keeps the exact selected reference for a legacy image widget', async () => {
		const wrapper = await mountComponent({
			type: 'image',
			fit: 'contain',
			opacity: 1,
			borderRadius: 0,
		});

		await wrapper.get('[data-testid="select-media"]').trigger('click');

		expect(wrapper.emitted('update')?.at(-1)?.[0]).toMatchObject({
			type: 'image',
			asset: {
				assetId: 'video-asset',
				revisionId: 'video-revision-4',
			},
		});
	});
});
