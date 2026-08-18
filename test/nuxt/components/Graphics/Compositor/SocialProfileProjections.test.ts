import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { squareShapeGeometry } from '~~/shared/modules/graphics';

enableAutoUnmount(afterEach);

const SlotOnlyStub = defineComponent({ template: '<div><slot /></div>' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, required: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});
const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: [String, Number], required: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
});
const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: { modelValue: { type: Number, required: false } },
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))">',
});
const USelectStub = defineComponent({
	name: 'USelect',
	props: { modelValue: { type: String, required: false }, items: { type: Array, default: () => [] } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
});

function graphic(overrides: Partial<BroadcastGraphicConfig> = {}): BroadcastGraphicConfig {
	return {
		id: 'lower-third',
		name: 'Lower Third',
		items: [],
		sources: [
			{ key: 'event', label: 'Event', kind: 'event' },
			{ key: 'talent-1', label: 'Talent 1', kind: 'talent', from: { sourceKey: 'event', relation: 'commentator1' } },
			{ key: 'operator-talent', label: 'Guest Talent', kind: 'talent' },
		],
		...overrides,
	};
}

async function mountComponent(options: {
	graphics?: BroadcastGraphicConfig[];
	selectedTarget?: GraphicsSelectionTarget;
	writable?: boolean;
} = {}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/SocialProfileProjections.vue';
	const { default: SocialProfileProjections } = await import(componentPath);
	return mount(SocialProfileProjections, {
		props: {
			graphics: options.graphics ?? [graphic()],
			selectedTarget: options.selectedTarget ?? { type: 'graphic', graphicId: 'lower-third' },
			canvasWidth: 1920,
			canvasHeight: 1080,
			writable: options.writable ?? true,
		},
		global: {
			stubs: {
				UFormField: SlotOnlyStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USelect: USelectStub,
				UBadge: true,
			},
		},
	});
}

function emittedGraphic(wrapper: Awaited<ReturnType<typeof mountComponent>>, index = 0) {
	return (wrapper.emitted('update:graphics')?.[index]?.[0] as BroadcastGraphicConfig[])[0]!;
}

describe('graphicsCompositorSocialProfileProjections', () => {
	it('creates the common starter from a named Talent source with settled defaults', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="social-profile-projection-label-new"] input').setValue('Caster profile');
		await wrapper.get('[data-testid="social-profile-projection-source-new"] select').setValue('operator-talent');
		await wrapper.get('[data-testid="social-profile-projection-add"]').trigger('click');

		const updated = emittedGraphic(wrapper);
		expect(updated.socialProfileProjections).toEqual([
			expect.objectContaining({
				key: 'caster-profile',
				label: 'Caster profile',
				sourceKey: 'operator-talent',
				dwellMs: 8_000,
				transition: 'crossfade',
				transitionDurationMs: 250,
			}),
		]);
		const group = updated.items[0];
		expect(group?.type).toBe('group');
		expect(group?.type === 'group' && group.children).toEqual([
			expect.objectContaining({ type: 'social-network-icon', network: { projectionKey: 'caster-profile' } }),
			expect.objectContaining({ type: 'text', text: '{caster-profile.handle}' }),
		]);
	});

	it('associates an existing eligible Graphic Group instead of generating a starter', async () => {
		const existing = {
			type: 'group' as const,
			id: 'designed-group',
			label: 'Designed group',
			visible: true,
			anchor: 'top-left' as const,
			x: 0,
			y: 0,
			width: 400,
			height: 100,
			arrangement: 'row' as const,
			padding: 0,
			gap: 8,
			align: 'stretch' as const,
			justify: 'start' as const,
			clip: false,
			geometry: squareShapeGeometry(),
			children: [],
		};
		const wrapper = await mountComponent({ graphics: [graphic({ items: [existing] })] });

		await wrapper.get('[data-testid="social-profile-projection-label-new"] input').setValue('Existing profile');
		await wrapper.get('[data-testid="social-profile-projection-group-new"] select').setValue('designed-group');
		await wrapper.get('[data-testid="social-profile-projection-add"]').trigger('click');

		const updated = emittedGraphic(wrapper);
		expect(updated.socialProfileProjections?.[0]).toMatchObject({ presentationGroupId: 'designed-group' });
		expect(updated.items).toEqual([existing]);
	});

	it('authors multiple projections with independent Talent sources and groups', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="social-profile-projection-add"]').trigger('click');
		const first = emittedGraphic(wrapper);
		await wrapper.setProps({ graphics: [first] });
		await wrapper.get('[data-testid="social-profile-projection-label-new"] input').setValue('Guest profile');
		await wrapper.get('[data-testid="social-profile-projection-source-new"] select').setValue('operator-talent');
		await wrapper.get('[data-testid="social-profile-projection-add"]').trigger('click');

		const second = emittedGraphic(wrapper, 1);
		expect(second.socialProfileProjections?.map(projection => projection.sourceKey))
			.toEqual(['talent-1', 'operator-talent']);
		expect(new Set(second.socialProfileProjections?.map(projection => projection.presentationGroupId)).size).toBe(2);
		expect(second.items).toHaveLength(2);
	});

	it('edits dwell and every bounded transition property while Cut ignores duration', async () => {
		const wrapper = await mountComponent();
		await wrapper.get('[data-testid="social-profile-projection-add"]').trigger('click');
		await wrapper.setProps({ graphics: [emittedGraphic(wrapper)] });

		await wrapper.get('[data-testid="social-profile-projection-dwell"]').setValue('60');
		let edited = emittedGraphic(wrapper, 1);
		expect(edited.socialProfileProjections?.[0]?.dwellMs).toBe(60_000);

		await wrapper.setProps({ graphics: [edited] });
		await wrapper.get('[data-testid="social-profile-projection-transition"]').setValue('slide-down');
		edited = emittedGraphic(wrapper, 2);
		expect(edited.socialProfileProjections?.[0]?.transition).toBe('slide-down');

		await wrapper.setProps({ graphics: [edited] });
		await wrapper.get('[data-testid="social-profile-projection-transition-duration"]').setValue('2000');
		edited = emittedGraphic(wrapper, 3);
		expect(edited.socialProfileProjections?.[0]?.transitionDurationMs).toBe(2_000);

		await wrapper.setProps({ graphics: [edited] });
		await wrapper.get('[data-testid="social-profile-projection-transition"]').setValue('cut');
		await wrapper.setProps({ graphics: [emittedGraphic(wrapper, 4)] });
		expect(wrapper.find('[data-testid="social-profile-projection-transition-duration"]').exists()).toBe(false);
	});

	it('explains and performs the explicit combined deletion of dependent content', async () => {
		const wrapper = await mountComponent();
		await wrapper.get('[data-testid="social-profile-projection-add"]').trigger('click');
		await wrapper.setProps({ graphics: [emittedGraphic(wrapper)] });

		expect(wrapper.get('[data-testid="social-profile-projection-deletion-feedback"]').text())
			.toContain('Replace them first');
		expect(wrapper.get('[data-testid="social-profile-projection-delete-keep-group"]').attributes('disabled'))
			.toBeDefined();
		await wrapper.get('[data-testid="social-profile-projection-delete-combined"]').trigger('click');

		const deleted = emittedGraphic(wrapper, 1);
		expect(deleted.socialProfileProjections).toEqual([]);
		expect(deleted.items).toEqual([]);
	});

	it('offers an observing session no projection write', async () => {
		const wrapper = await mountComponent({ writable: false });

		expect(wrapper.find('[data-testid="social-profile-projection-new"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="social-profile-projection-delete-combined"]').exists()).toBe(false);
		expect(wrapper.emitted('update:graphics')).toBeUndefined();
	});

	it('names the source prerequisite when no Talent source is declared', async () => {
		const wrapper = await mountComponent({ graphics: [graphic({ sources: [] })] });

		expect(wrapper.get('[data-testid="social-profile-projection-no-talent-source"]').text())
			.toContain('operator selected or derived from Event Talent 1 or Talent 2');
		expect(wrapper.get('[data-testid="social-profile-projection-add"]').attributes('disabled')).toBeDefined();
	});
});
