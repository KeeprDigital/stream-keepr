import type { Screen } from '~/types';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import {
	GRAPHICS_PREVIEW_READY_MESSAGE,
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	GRAPHICS_PREVIEW_STATE_MESSAGE,
} from '~/modules/graphics/previewMessages';

enableAutoUnmount(afterEach);

const graphics = [{
	id: 'lower-third',
	name: 'Lower Third',
	items: [{
		type: 'shape' as const,
		id: 'bar',
		label: 'Shape 1',
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 100,
		height: 40,
		geometry: { cornerRadius: 0 },
		surfaceStyle: { fill: '#0077a3', fillOpacity: 1 },
	}],
}];

const ScreenSettingsCardStub = defineComponent({
	template: '<section><slot name="actions" :open="true" /><slot /></section>',
});

const SlotOnlyStub = defineComponent({ template: '<div><slot /></div>' });

const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

const USelectMenuStub = defineComponent({
	name: 'USelectMenu',
	props: { modelValue: { type: [String, Number], required: false }, items: { type: Array, default: () => [] } },
	emits: ['update:modelValue'],
	template: '<select @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="String(item.value)" :value="item.value">{{ item.label }}</option></select>',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

async function mountComponent(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Preview.vue';
	const { default: Preview } = await import(componentPath);

	return mount(Preview, {
		props: {
			eventId: 1,
			screen: { id: 1, slug: 'main', screenConfig: { width: 1920, height: 1080 } } as Screen,
			graphics,
			selectedTarget: { type: 'canvas' },
			canvasWidth: 1920,
			canvasHeight: 1080,
			...props,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UFormField: SlotOnlyStub,
				USwitch: USwitchStub,
				UFieldGroup: SlotOnlyStub,
				UButton: UButtonStub,
				USelectMenu: USelectMenuStub,
			},
		},
	});
}

describe('graphicsCompositorPreview', () => {
	it('embeds a Screen Output frame that asks for item guides but not safe areas by default', async () => {
		const wrapper = await mountComponent();
		const src = wrapper.get('iframe').attributes('src') ?? '';

		expect(src).toContain('output=overlay');
		expect(src).toContain('embed=preview');
		expect(src).toContain('guides=1');
		expect(src).not.toContain('safe=1');
	});

	it('asks the preview frame for advisory safe-area guides only when the author turns them on', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="compositor-safe-area-guides"]').trigger('click');
		await nextTick();

		expect(wrapper.get('iframe').attributes('src')).toContain('safe=1');
	});

	it('stops asking for item guides when the author turns them off', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="compositor-item-guides"]').trigger('click');
		await nextTick();

		expect(wrapper.get('iframe').attributes('src')).not.toContain('guides=1');
	});

	it('selects the Fill and Key Screen Outputs from the same stable Screen URL', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[aria-label="Fill preview output"]').trigger('click');
		await nextTick();
		expect(wrapper.get('iframe').attributes('src')).toContain('output=fill');

		await wrapper.get('[aria-label="Key preview output"]').trigger('click');
		await nextTick();
		expect(wrapper.get('iframe').attributes('src')).toContain('output=key');
	});

	it('zooms the preview to the canvas at a fixed scale', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[aria-label="100% preview zoom"]').trigger('click');
		await nextTick();

		const style = wrapper.get('iframe').element.parentElement?.getAttribute('style') ?? '';
		expect(style).toContain('width: 1920px');
		expect(style).toContain('height: 1080px');
	});

	it('pushes the working composition into its own preview frame', async () => {
		const wrapper = await mountComponent();
		const frame = wrapper.get('iframe').element;
		const posted: unknown[] = [];
		Object.defineProperty(frame, 'contentWindow', {
			configurable: true,
			value: { postMessage: (message: unknown) => posted.push(message) },
		});

		await wrapper.get('iframe').trigger('load');

		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({
			type: GRAPHICS_PREVIEW_STATE_MESSAGE,
			state: { selectedTarget: { type: 'canvas' } },
		});
		expect((posted[0] as { state: { graphics: unknown[] } }).state.graphics).toHaveLength(1);
	});

	/**
	 * The frame's `message` listener is installed when its app mounts, and this
	 * application renders on the client — so the iframe's `load` event, which the
	 * push above rides, fires before that as often as after it. A push that lost
	 * that race was dropped in silence and left the preview composing the Screen's
	 * persisted stack, which does not look like a missed message (#234).
	 */
	it('pushes again when the frame reports that it is listening', async () => {
		const wrapper = await mountComponent();
		const frame = wrapper.get('iframe').element;
		const posted: unknown[] = [];
		Object.defineProperty(frame, 'contentWindow', {
			configurable: true,
			value: { postMessage: (message: unknown) => posted.push(message), self: true },
		});

		// No `load` at all: the frame speaks first, which is the case the handshake
		// exists for.
		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: frame.contentWindow,
			data: { type: GRAPHICS_PREVIEW_READY_MESSAGE },
		}));
		await nextTick();

		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatchObject({ type: GRAPHICS_PREVIEW_STATE_MESSAGE });
	});

	it('answers no ready announced by a window it did not embed', async () => {
		const wrapper = await mountComponent();
		const frame = wrapper.get('iframe').element;
		const posted: unknown[] = [];
		Object.defineProperty(frame, 'contentWindow', {
			configurable: true,
			value: { postMessage: (message: unknown) => posted.push(message) },
		});

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: window,
			data: { type: GRAPHICS_PREVIEW_READY_MESSAGE },
		}));
		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://elsewhere.test',
			source: frame.contentWindow,
			data: { type: GRAPHICS_PREVIEW_READY_MESSAGE },
		}));
		await nextTick();

		expect(posted).toHaveLength(0);
	});

	it('accepts a canvas selection only from its own preview frame', async () => {
		const wrapper = await mountComponent();
		const frame = wrapper.get('iframe').element;
		Object.defineProperty(frame, 'contentWindow', { configurable: true, value: window });
		const target = { type: 'item', graphicId: 'lower-third', itemId: 'bar' };

		window.dispatchEvent(new MessageEvent('message', {
			origin: window.location.origin,
			source: window,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target },
		}));
		await nextTick();

		expect(wrapper.emitted('selectTarget')?.[0]?.[0]).toEqual(target);

		window.dispatchEvent(new MessageEvent('message', {
			origin: 'https://elsewhere.test',
			source: window,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: { type: 'canvas' } },
		}));
		await nextTick();

		expect(wrapper.emitted('selectTarget')).toHaveLength(1);
	});
});

describe('graphicAnimationPreview', () => {
	function posted(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
		const frame = wrapper.get('iframe').element;
		const messages: Array<{ type: string; state: Record<string, unknown> }> = [];
		Object.defineProperty(frame, 'contentWindow', {
			configurable: true,
			value: { postMessage: (message: unknown) => messages.push(message as never) },
		});
		return messages;
	}

	function latestPlan(messages: Array<{ state: Record<string, unknown> }>) {
		return messages[messages.length - 1]?.state.animation ?? null;
	}

	it('composes at the Graphic Resting State until an author starts a run', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('iframe').trigger('load');

		// No plan means no motion: laying a composition out is the default, and an
		// author never has to stop a preview to author.
		expect(latestPlan(messages)).toBeNull();
	});

	it('plays one lifecycle phase of the Broadcast Graphic under authoring', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();

		expect(latestPlan(messages)).toMatchObject({
			graphicId: 'lower-third',
			scope: 'phase',
			phase: 'enter',
			speed: 1,
			loop: false,
		});
	});

	it('previews the graphic that contains the selected Graphic Item', async () => {
		const wrapper = await mountComponent({
			selectedTarget: { type: 'item', graphicId: 'lower-third', itemId: 'bar' },
		});
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();

		expect(latestPlan(messages)).toMatchObject({ graphicId: 'lower-third' });
	});

	it('offers no run at all with no Broadcast Graphic selected', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'canvas' } });

		expect(wrapper.find('[data-testid="animation-preview-hint"]').exists()).toBe(true);

		const messages = posted(wrapper);
		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();

		expect(latestPlan(messages)).toBeNull();
	});

	it('plays a full lifecycle from the selected phase onwards', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-scope-lifecycle"]').trigger('click');
		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();

		expect(latestPlan(messages)).toMatchObject({ scope: 'lifecycle', phase: 'enter' });
	});

	it('varies playback speed and loops an on-screen cycle', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-speed-0.25"]').trigger('click');
		await wrapper.get('[data-testid="animation-preview-loop"]').trigger('click');
		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();

		expect(latestPlan(messages)).toMatchObject({ speed: 0.25, loop: true });
	});

	it('restarts a run with a new token rather than a time, so there is no playhead', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();
		const first = latestPlan(messages) as { run: number };

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();
		const second = latestPlan(messages) as { run: number };

		expect(second.run).toBeGreaterThan(first.run);
		expect(Object.keys(second)).not.toContain('startedAt');
		expect(Object.keys(second)).not.toContain('elapsed');
	});

	it('stops a run back to the Graphic Resting State', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();
		await wrapper.get('[data-testid="animation-preview-stop"]').trigger('click');
		await nextTick();

		expect(latestPlan(messages)).toBeNull();
	});

	it('stops a run when the author selects a different Broadcast Graphic', async () => {
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();
		await wrapper.setProps({ selectedTarget: { type: 'graphic', graphicId: 'bug' } });
		await nextTick();

		expect(latestPlan(messages)).toBeNull();
	});

	it('reaches the preview frame only, and never live Screen state', async () => {
		// Gating, stated as a property of the surface: the preview's whole channel is
		// one postMessage to the frame it embedded. It emits no configuration update,
		// so there is nothing for a caller to persist, and it addresses no other window.
		const wrapper = await mountComponent({ selectedTarget: { type: 'graphic', graphicId: 'lower-third' } });
		const messages = posted(wrapper);

		await wrapper.get('[data-testid="animation-preview-play"]').trigger('click');
		await nextTick();

		expect(messages.every(message => message.type === GRAPHICS_PREVIEW_STATE_MESSAGE)).toBe(true);
		expect(wrapper.emitted('update:graphics')).toBeUndefined();
		expect(wrapper.emitted('selectTarget')).toBeUndefined();
	});
});
