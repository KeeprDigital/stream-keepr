import type { ScreenMediaSource } from '~~/shared/types/screenConfig';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import MediaSourceField from '~/components/Screen/MediaSourceField.vue';

/**
 * The one Screen Media Source picker (ADR-0021): library or Remote Media URL,
 * shared by every Background Layer and the Feature Match Overlay Frame.
 */

enableAutoUnmount(afterEach);

const USelectStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select data-testid="source-kind" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});

const UInputStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-testid="source-url" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const FocusPickerStub = defineComponent({
	name: 'GraphicsAssetFocusPicker',
	props: {
		modelValue: { type: Object, required: false },
		assetKind: { type: String, required: false },
	},
	emits: ['select', 'update:modelValue'],
	template: '<div data-testid="source-asset" :data-asset-kind="assetKind" />',
});

const global = {
	stubs: {
		UFormField: defineComponent({
			props: {
				error: {
					type: [String, Boolean],
					required: false,
				},
			},
			template: '<div><slot /><p v-if="typeof error === \'string\'" data-testid="field-error">{{ error }}</p></div>',
		}),
		USelect: USelectStub,
		UInput: UInputStub,
		GraphicsAssetFocusPicker: FocusPickerStub,
	},
};

const librarySource: ScreenMediaSource = { kind: 'asset', assetId: 'plate' as never, revisionId: 'plate-1' as never };

function mountField(modelValue: ScreenMediaSource | undefined) {
	return mount(MediaSourceField, {
		global,
		props: {
			modelValue,
			eventId: 7,
			assetKind: 'silent-video',
			label: 'Video asset',
		},
	});
}

describe('the Screen Media Source field', () => {
	it('edits a Remote Media URL as typed', async () => {
		const wrapper = mountField({ kind: 'url', url: '' });

		await wrapper.find('[data-testid="source-url"]').setValue('https://cdn.example.com/loop.webm');

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
			{ kind: 'url', url: 'https://cdn.example.com/loop.webm' },
		]);
	});

	it('refuses a root-relative path the application does not serve as media, and says where library media comes from', () => {
		const wrapper = mountField({ kind: 'url', url: '/api/graphics-assets/plate/revisions/plate-1/content' });

		const error = wrapper.find('[data-testid="field-error"]');
		expect(error.exists()).toBe(true);
		expect(error.text()).toContain('/video/');
		expect(error.text()).toContain('Asset library');
	});

	it('shows no refusal for media the application serves, an HTTPS URL, or an unset URL', () => {
		for (const url of ['/video/loop.mp4', 'https://cdn.example.com/loop.webm', ''])
			expect(mountField({ kind: 'url', url }).find('[data-testid="field-error"]').exists(), url).toBe(false);
	});

	it('offers the library without writing anything until an asset is chosen', async () => {
		const wrapper = mountField({ kind: 'url', url: '' });

		await wrapper.find('[data-testid="source-kind"]').setValue('asset');

		// A library source with no revision is not storable, so the switch is UI state.
		expect(wrapper.find('[data-testid="source-asset"]').attributes('data-asset-kind')).toBe('silent-video');
		expect(wrapper.emitted('update:modelValue')).toBeUndefined();

		wrapper.findComponent(FocusPickerStub).vm.$emit('select', {}, { assetId: 'loop', revisionId: 'loop-2' });

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
			{ kind: 'asset', assetId: 'loop', revisionId: 'loop-2' },
		]);
	});

	it('starts a URL over when switching away from the library', async () => {
		const wrapper = mountField(librarySource);

		await wrapper.find('[data-testid="source-kind"]').setValue('url');

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
			{ kind: 'url', url: '' },
		]);
	});

	it('answers the picker’s Clear with no source at all', () => {
		const wrapper = mountField(librarySource);

		wrapper.findComponent(FocusPickerStub).vm.$emit('update:modelValue', undefined);

		expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null]);
	});

	it('shows an unset source as the library', () => {
		const wrapper = mountField(undefined);

		expect(wrapper.find('[data-testid="source-asset"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="source-url"]').exists()).toBe(false);
	});
});
