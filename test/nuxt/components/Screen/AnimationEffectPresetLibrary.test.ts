import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const preset = {
	id: 'preset-1',
	name: 'Reusable fog',
	revision: 3,
	selection: { effect: 'fog', params: { speed: 0.4 } },
	createdAt: new Date(),
	updatedAt: new Date(),
};

const repository = {
	list: vi.fn(async () => [preset]),
	create: vi.fn(async () => preset),
	update: vi.fn(async () => preset),
	remove: vi.fn(async () => undefined),
	importDocument: vi.fn(async () => preset),
	exportUrl: vi.fn((id: string) => `/api/animation-effect-presets/${id}/export`),
};

mockNuxtImport('useAnimationEffectPresetRepository', () => () => repository);

const UButtonStub = defineComponent({
	props: { disabled: Boolean, to: String },
	emits: ['click'],
	template: '<a v-if="to" :href="to"><slot /></a><button v-else type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

async function mountLibrary(selection = { effect: 'caustics' as const, params: { speed: 0.7 } }) {
	const { default: Library } = await import('../../../../app/components/Screen/AnimationEffectPresetLibrary.vue');
	const wrapper = mount(Library, {
		props: { selection },
		global: {
			stubs: {
				UButton: UButtonStub,
				UAlert: { template: '<div><slot /></div>' },
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('animation Effect Preset library editor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		repository.list.mockResolvedValue([preset]);
	});

	it('applies a library selection as an independent copy and exposes its portable export', async () => {
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="animation-effect-preset-select"]').setValue(preset.id);
		await wrapper.get('[data-testid="animation-effect-preset-apply"]').trigger('click');

		expect(wrapper.emitted('apply')).toEqual([[preset.selection]]);
		expect(wrapper.get('[data-testid="animation-effect-preset-export"]').attributes('href'))
			.toBe(`/api/animation-effect-presets/${preset.id}/export`);
	});

	it('saves the current selection and replaces the chosen preset with revision protection', async () => {
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="animation-effect-preset-name"]').setValue('Updated effect');
		await wrapper.get('[data-testid="animation-effect-preset-save"]').trigger('click');

		expect(repository.create).toHaveBeenCalledWith({
			name: 'Updated effect',
			selection: { effect: 'caustics', params: { speed: 0.7 } },
		});

		await wrapper.get('[data-testid="animation-effect-preset-select"]').setValue(preset.id);
		await wrapper.get('[data-testid="animation-effect-preset-name"]').setValue('Updated effect');
		await wrapper.get('[data-testid="animation-effect-preset-replace"]').trigger('click');
		expect(repository.update).toHaveBeenCalledWith(preset.id, {
			name: 'Updated effect',
			revision: 3,
			selection: { effect: 'caustics', params: { speed: 0.7 } },
		});
	});

	it('imports a selected .skeffect file then refreshes the installation library', async () => {
		const wrapper = await mountLibrary();
		const input = wrapper.get('[data-testid="animation-effect-preset-import"]');
		const file = new File(['portable preset'], 'shared.skeffect', { type: 'application/json' });
		Object.defineProperty(input.element, 'files', { value: [file] });

		await input.trigger('change');
		await flushPromises();

		expect(repository.importDocument).toHaveBeenCalledWith('portable preset');
		expect(repository.list).toHaveBeenCalledTimes(2);
	});
});
