import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import MediaBackgroundFields from '~/components/Screen/MediaBackgroundFields.vue';

/**
 * The Feature Match Overlay Frame's video: its switch and URL, then the shared
 * media fields for fit, opacity, and playback.
 */

enableAutoUnmount(afterEach);

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: { modelValue: { type: Number, required: false } },
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const global = {
	stubs: {
		UFormField: defineComponent({ template: '<div><slot /></div>' }),
		UInput: defineComponent({ template: '<input />' }),
		USelect: defineComponent({ template: '<select />' }),
		USwitch: defineComponent({ template: '<input type="checkbox" />' }),
		ScreenSettingsToggle: defineComponent({ template: '<input type="checkbox" />' }),
		UInputNumber: UInputNumberStub,
	},
};

const media = { enabled: true, source: { kind: 'url' as const, url: '/video/loop.mp4' }, fit: 'cover' as const, opacity: 0.5, playbackRate: 2, loop: true };

function numberField(wrapper: ReturnType<typeof mount>, testId: string) {
	return wrapper.findAllComponents(UInputNumberStub).find(input => input.attributes('data-testid') === testId)!;
}

describe('media background fields', () => {
	it('offers the shared fit, opacity, and playback fields once the video is on', () => {
		const wrapper = mount(MediaBackgroundFields, { global, props: { media, eventId: 7 } });

		for (const testId of ['media-fit', 'media-opacity', 'media-playback-rate', 'media-loop'])
			expect(wrapper.find(`[data-testid="${testId}"]`).exists(), testId).toBe(true);
		expect(wrapper.find('[data-testid="media-focal-horizontal"]').exists()).toBe(false);
	});

	it('returns a cleared opacity or playback rate to its default rather than to zero', async () => {
		const wrapper = mount(MediaBackgroundFields, { global, props: { media, eventId: 7 } });

		numberField(wrapper, 'media-opacity').vm.$emit('update:modelValue', null);
		await flushPromises();
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ opacity: 1 });

		numberField(wrapper, 'media-playback-rate').vm.$emit('update:modelValue', null);
		await flushPromises();
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ playbackRate: 1 });
	});
});
