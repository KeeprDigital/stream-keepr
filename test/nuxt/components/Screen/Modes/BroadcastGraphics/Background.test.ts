import type { BroadcastGraphicsBackgroundConfig } from '~~/shared/types/screenConfig';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

enableAutoUnmount(afterEach);

async function mountCard(props: {
	background?: BroadcastGraphicsBackgroundConfig;
	writable?: boolean;
} = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/Background.vue';
	const { default: Background } = await import(componentPath);

	return mount(Background, { props: { writable: true, ...props } });
}

type Emitted = Array<[BroadcastGraphicsBackgroundConfig | undefined]>;

function backgroundEmits(wrapper: Awaited<ReturnType<typeof mountCard>>): Emitted {
	return (wrapper.emitted('update:background') ?? []) as Emitted;
}

async function setOpacity(wrapper: Awaited<ReturnType<typeof mountCard>>, value: string) {
	const input = wrapper.get('[data-testid="broadcast-graphics-background-opacity"] input');
	await input.setValue(value);
	await input.trigger('change');
	await input.trigger('blur');
}

async function toggleEnabled(wrapper: Awaited<ReturnType<typeof mountCard>>, next: boolean) {
	await wrapper.getComponent({ name: 'ScreenSettingsToggle' }).setValue(next);
}

describe('screenModesBroadcastGraphicsBackground', () => {
	it('starts a Screen with no background on the catalogue’s first effect, switched on', async () => {
		const wrapper = await mountCard();

		expect(wrapper.find('[data-testid="broadcast-graphics-background-opacity"]').exists()).toBe(false);

		await toggleEnabled(wrapper, true);

		expect(backgroundEmits(wrapper).at(-1)?.[0]).toEqual({ enabled: true, effect: 'fog', opacity: 1 });
	});

	it('keeps the authored effect and its params when the background is switched off', async () => {
		// Switching off is a display state, not a removal: an author toggling it back
		// on gets the design they tuned, not the catalogue's starting point.
		const wrapper = await mountCard({
			background: { enabled: true, effect: 'caustics', opacity: 0.4, params: { speed: 2 } },
		});

		await toggleEnabled(wrapper, false);

		expect(backgroundEmits(wrapper).at(-1)?.[0]).toEqual({
			enabled: false,
			effect: 'caustics',
			opacity: 0.4,
			params: { speed: 2 },
		});
	});

	it('writes a new opacity without disturbing the selection', async () => {
		const wrapper = await mountCard({
			background: { enabled: true, effect: 'fog', opacity: 0.4, params: { speed: 2 } },
		});

		await setOpacity(wrapper, '0.25');

		expect(backgroundEmits(wrapper).at(-1)?.[0]).toMatchObject({
			enabled: true,
			effect: 'fog',
			opacity: 0.25,
			params: { speed: 2 },
		});
	});

	it('takes a whole selection from the shared Animation Effect fields, keeping its own host fields', async () => {
		const wrapper = await mountCard({
			background: { enabled: true, effect: 'fog', opacity: 0.4, params: { speed: 2 } },
		});

		wrapper.getComponent({ name: 'ScreenAnimationEffectFields' })
			.vm
			.$emit('update:selection', { effect: 'cells' });
		await wrapper.vm.$nextTick();

		expect(backgroundEmits(wrapper).at(-1)?.[0]).toEqual({ enabled: true, effect: 'cells', opacity: 0.4 });
	});

	it('starts over from the defaults for a stored background this build cannot render', async () => {
		// The vocabulary refusal in the editor, on the Frame's precedent: a config
		// naming an effect this build does not ship starts the card over from the
		// defaults rather than carrying fields no effect declares into the next write.
		const wrapper = await mountCard({
			background: { enabled: true, effect: 'vanta-birds', opacity: 0.4 } as unknown as BroadcastGraphicsBackgroundConfig,
		});

		expect(wrapper.find('[data-testid="broadcast-graphics-background-opacity"]').exists()).toBe(false);

		await toggleEnabled(wrapper, true);

		expect(backgroundEmits(wrapper).at(-1)?.[0]).toEqual({ enabled: true, effect: 'fog', opacity: 1 });
	});

	it('writes nothing without the Graphics Authoring Lease', async () => {
		const wrapper = await mountCard({
			background: { enabled: true, effect: 'fog', opacity: 0.4 },
			writable: false,
		});

		await toggleEnabled(wrapper, false);
		await setOpacity(wrapper, '0.25');

		expect(backgroundEmits(wrapper)).toHaveLength(0);
	});
});
