import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import MediaFields from '~/components/Graphics/MediaFields.vue';
import { resolveMediaFieldsPatch } from '~/utils/mediaFields';

/**
 * The one media fields control, shared by Media Graphic Items, media treatment
 * presets, image and video Background Layers, and the Feature Match Overlay
 * Frame's video: which fields each host is offered, the one Media Fit list, the
 * playback-rate bounds, and what a cleared field emits.
 */

enableAutoUnmount(afterEach);

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, required: false },
		min: { type: Number, required: false },
		max: { type: Number, required: false },
		step: { type: Number, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: String, required: false },
		items: {
			type: Array,
			default: () => [],
		},
	},
	emits: ['update:modelValue'],
	template: '<select />',
});

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: {
		modelValue: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" />',
});

const global = {
	stubs: {
		UFormField: defineComponent({
			props: { label: String },
			template: '<label><span>{{ label }}</span><slot /></label>',
		}),
		UInputNumber: UInputNumberStub,
		USelect: USelectStub,
		USwitch: USwitchStub,
	},
};

const media = {
	fit: 'cover' as const,
	opacity: 0.8,
	focalPosition: { horizontal: 0.25, vertical: 0.75 },
	playbackRate: 1.5,
	loop: true,
};

function mountFields(props: Record<string, unknown> = {}) {
	return mount(MediaFields, {
		global,
		props: { media, ...props },
	});
}

type Wrapper = ReturnType<typeof mountFields>;

function numberField(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents(UInputNumberStub).find(input => input.attributes('data-testid') === testId);
}

async function enter(wrapper: Wrapper, testId: string, value: number | null) {
	numberField(wrapper, testId)!.vm.$emit('update:modelValue', value);
	await flushPromises();
	return wrapper.emitted('update')?.at(-1)?.[0];
}

describe('media fields', () => {
	it('offers only fit unless the host asks for more', () => {
		const wrapper = mountFields();

		expect(wrapper.findAllComponents(USelectStub)).toHaveLength(1);
		expect(wrapper.findAllComponents(UInputNumberStub)).toHaveLength(0);
		expect(wrapper.findAllComponents(USwitchStub)).toHaveLength(0);
	});

	it('offers opacity, focal position, and playback each by prop', () => {
		const wrapper = mountFields({ opacity: true, focal: true, playback: true });

		for (const testId of [
			'media-opacity',
			'media-focal-horizontal',
			'media-focal-vertical',
			'media-playback-rate',
		])
			expect(numberField(wrapper, testId), testId).toBeDefined();
		expect(wrapper.find('[data-testid="media-loop"]').exists()).toBe(true);

		const playbackOnly = mountFields({ playback: true });
		expect(numberField(playbackOnly, 'media-opacity')).toBeUndefined();
		expect(numberField(playbackOnly, 'media-focal-horizontal')).toBeUndefined();
	});

	it('offers one Media Fit list: Cover, Contain, Fill', () => {
		const wrapper = mountFields();

		expect(wrapper.getComponent(USelectStub).props('items')).toEqual([
			{ label: 'Cover', value: 'cover' },
			{ label: 'Contain', value: 'contain' },
			{ label: 'Fill', value: 'fill' },
		]);
	});

	it('bounds the playback rate to 0.25–4 in steps of 0.05', () => {
		const rate = numberField(mountFields({ playback: true }), 'media-playback-rate')!;

		expect(rate.props()).toMatchObject({ min: 0.25, max: 4, step: 0.05 });
	});

	it('emits each edit as a patch of that one field', async () => {
		const wrapper = mountFields({ opacity: true, focal: true, playback: true });

		wrapper.getComponent(USelectStub).vm.$emit('update:modelValue', 'contain');
		await flushPromises();
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ fit: 'contain' });

		expect(await enter(wrapper, 'media-opacity', 0.4)).toEqual({ opacity: 0.4 });
		expect(await enter(wrapper, 'media-playback-rate', 2)).toEqual({ playbackRate: 2 });

		wrapper.getComponent(USwitchStub).vm.$emit('update:modelValue', false);
		await flushPromises();
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ loop: false });
	});

	it('moves one focal axis, keeping the other', async () => {
		const wrapper = mountFields({ focal: true });

		expect(await enter(wrapper, 'media-focal-horizontal', 0.1)).toEqual({
			focalPosition: { horizontal: 0.1, vertical: 0.75 },
		});
		expect(await enter(wrapper, 'media-focal-vertical', null)).toEqual({
			focalPosition: { horizontal: 0.25, vertical: 0.5 },
		});
	});

	it('emits null for a cleared opacity or playback rate, for the host to resolve', async () => {
		const wrapper = mountFields({ opacity: true, playback: true });

		expect(await enter(wrapper, 'media-opacity', null)).toEqual({ opacity: null });
		expect(await enter(wrapper, 'media-playback-rate', null)).toEqual({ playbackRate: null });
	});

	it('disables every field for an observer', () => {
		const wrapper = mountFields({
			opacity: true,
			focal: true,
			playback: true,
			disabled: true,
		});

		for (const field of [
			...wrapper.findAllComponents(UInputNumberStub),
			wrapper.getComponent(USelectStub),
			wrapper.getComponent(USwitchStub),
		])
			expect(field.attributes('disabled')).toBeDefined();
	});
});

describe('resolveMediaFieldsPatch', () => {
	it('turns a cleared opacity into opaque and a cleared playback rate into normal speed', () => {
		expect(resolveMediaFieldsPatch({ opacity: null })).toEqual({ opacity: 1 });
		expect(resolveMediaFieldsPatch({ playbackRate: null })).toEqual({ playbackRate: 1 });
	});

	it('passes every other edit through unchanged', () => {
		const focalPosition = { horizontal: 0.1, vertical: 0.2 };

		expect(resolveMediaFieldsPatch({ fit: 'fill' })).toEqual({ fit: 'fill' });
		expect(resolveMediaFieldsPatch({ opacity: 0.3 })).toEqual({ opacity: 0.3 });
		expect(resolveMediaFieldsPatch({ focalPosition })).toEqual({ focalPosition });
		expect(resolveMediaFieldsPatch({ loop: false })).toEqual({ loop: false });
	});
});
