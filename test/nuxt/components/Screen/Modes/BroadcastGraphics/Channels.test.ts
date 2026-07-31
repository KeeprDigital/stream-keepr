import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';

enableAutoUnmount(afterEach);

/**
 * Graphic Channel authoring on a Broadcast Graphics Screen.
 *
 * The panel declares lanes and joins Broadcast Graphics to them. Every assertion
 * here is about the write it emits rather than about its markup, because the write
 * is what the Screen stores and what every reader then resolves membership from.
 */

const UButtonStub = defineComponent({
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

const UInputStub = defineComponent({
	props: { modelValue: { type: String, default: '' }, disabled: { type: Boolean, default: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)">',
});

const USelectStub = defineComponent({
	props: {
		modelValue: { type: [String, null], default: null },
		items: { type: Array, default: () => [] },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue ?? \'\'" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value === \'\' ? null : $event.target.value)"><option v-for="item in items" :key="String(item.value)" :value="item.value ?? \'\'">{{ item.label }}</option></select>',
});

const lowerThirdA: BroadcastGraphicConfig = { id: 'alpha', name: 'Alpha', items: [] };
const lowerThirdB: BroadcastGraphicConfig = { id: 'bravo', name: 'Bravo', items: [], channelId: 'thirds' };
const thirds: GraphicChannelConfig = { id: 'thirds', name: 'Lower thirds' };

async function mountPanel(props: {
	graphics?: BroadcastGraphicConfig[];
	channels?: GraphicChannelConfig[];
	writable?: boolean;
} = {}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/BroadcastGraphics/Channels.vue';
	const { default: Channels } = await import(componentPath);

	const wrapper = mount(Channels, {
		props: {
			graphics: [lowerThirdA, lowerThirdB],
			channels: [thirds],
			writable: true,
			...props,
		},
		global: {
			stubs: { UButton: UButtonStub, UInput: UInputStub, USelect: USelectStub, UIcon: true },
		},
	});
	await flushPromises();
	return wrapper;
}

/** The single write the panel emitted, or nothing when it emitted none. */
function written(wrapper: Awaited<ReturnType<typeof mountPanel>>) {
	const emitted = wrapper.emitted('update:channels');
	return emitted?.[emitted.length - 1]?.[0] as
		| { channels?: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }
		| undefined;
}

describe('broadcastGraphicsChannels', () => {
	it('declares a new Graphic Channel', async () => {
		const wrapper = await mountPanel({ channels: [] });

		await wrapper.get('[data-testid="graphic-channel-add"]').trigger('click');

		expect(written(wrapper)?.channels).toHaveLength(1);
	});

	it('shows a Graphic Channel that states no policy as Overlap, which is what it defaults to', async () => {
		const wrapper = await mountPanel();

		expect(
			(wrapper.get('[data-testid="graphic-channel-policy"]').element as unknown as HTMLSelectElement).value,
		).toBe('overlap');
	});

	it('sets a Graphic Channel Handoff Policy', async () => {
		const wrapper = await mountPanel();

		const select = wrapper.get('[data-testid="graphic-channel-policy"]');
		(select.element as unknown as HTMLSelectElement).value = 'out-then-in';
		await select.trigger('change');

		expect(written(wrapper)?.channels).toEqual([{ id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' }]);
	});

	it('joins a Broadcast Graphic to a Graphic Channel without touching anything else about it', async () => {
		const wrapper = await mountPanel();

		const picker = wrapper.get('[data-graphic-channel-membership="alpha"] select');
		(picker.element as unknown as HTMLSelectElement).value = 'thirds';
		await picker.trigger('change');

		// Membership moves no channel, so the write carries none: it says what changed.
		expect(written(wrapper)).toEqual({
			graphics: [{ ...lowerThirdA, channelId: 'thirds' }, lowerThirdB],
		});
	});

	it('releases a Broadcast Graphic rather than storing an empty membership', async () => {
		const wrapper = await mountPanel();

		const picker = wrapper.get('[data-graphic-channel-membership="bravo"] select');
		(picker.element as unknown as HTMLSelectElement).value = '';
		await picker.trigger('change');

		expect(written(wrapper)?.graphics?.[1]).toEqual({ id: 'bravo', name: 'Bravo', items: [] });
	});

	it('releases every member in the same write that deletes their Graphic Channel', async () => {
		// Two writes would leave the Screen briefly holding a graphic that names a lane it
		// no longer declares — resolved tolerantly everywhere, but never authored here.
		const wrapper = await mountPanel();

		await wrapper.get('[data-testid="graphic-channel-remove"]').trigger('click');

		expect(written(wrapper)).toEqual({
			channels: [],
			graphics: [lowerThirdA, { id: 'bravo', name: 'Bravo', items: [] }],
		});
	});

	it('shows an observing session the lanes and policies read-only', async () => {
		const wrapper = await mountPanel({ writable: false });

		expect(wrapper.get('[data-testid="graphic-channel-add"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-testid="graphic-channel-name"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-testid="graphic-channel-policy"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-testid="graphic-channel-remove"]').attributes('disabled')).toBeDefined();
	});

	it('reads membership of a Graphic Channel the Screen no longer declares as no membership', async () => {
		const wrapper = await mountPanel({ channels: [{ id: 'other', name: 'Other' }] });

		expect(
			(wrapper.get('[data-graphic-channel-membership="bravo"] select').element as unknown as HTMLSelectElement).value,
		).toBe('');
	});
});
