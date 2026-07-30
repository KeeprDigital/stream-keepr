import type { BroadcastGraphicTemplateSummary } from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

enableAutoUnmount(afterEach);

const mockList = vi.fn();
const mockSave = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockPlace = vi.fn();

mockNuxtImport('useBroadcastGraphicTemplateRepository', () => () => ({
	list: mockList,
	get: vi.fn(),
	save: mockSave,
	update: mockUpdate,
	remove: mockRemove,
	place: mockPlace,
}));

const mockGetScreenById = vi.fn();

mockNuxtImport('useScreenStore', () => () => ({ getScreenById: mockGetScreenById }));

const ScreenSettingsCardStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<section><h2>{{ title }}</h2><slot /></section>',
});
const UIEmptyStateStub = defineComponent({
	props: { title: { type: String, required: false } },
	template: '<div data-testid="empty-state">{{ title }}</div>',
});
const UAlertStub = defineComponent({
	props: { title: { type: String, required: false }, description: { type: String, required: false } },
	template: '<div><strong>{{ title }}</strong><span>{{ description }}</span></div>',
});
const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UIconStub = defineComponent({ template: '<i />' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, default: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});
const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: String, default: '' } },
	emits: ['update:modelValue', 'change', 'blur'],
	template: '<input :value="modelValue" @change="$emit(\'change\', $event)" @blur="$emit(\'blur\', $event)" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<label><span>{{ label }}</span><slot /></label>',
});

const lowerThird: BroadcastGraphicConfig = {
	id: 'placed-lower-third',
	name: 'Lower third',
	items: [],
};

function summary(overrides: Partial<BroadcastGraphicTemplateSummary> = {}): BroadcastGraphicTemplateSummary {
	return {
		id: 'template-1',
		name: 'Lower third',
		description: null,
		revision: 1,
		itemCount: 4,
		inputCount: 2,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		...overrides,
	};
}

async function mountLibrary(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/Graphics/TemplateLibrary.vue';
	const { default: TemplateLibrary } = await import(componentPath);

	const wrapper = mount(TemplateLibrary, {
		props: {
			eventId: 7,
			screenId: 3,
			selectedGraphic: lowerThird,
			writable: true,
			...props,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UAlert: UAlertStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				UFormField: UFormFieldStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('graphicsTemplateLibrary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockList.mockResolvedValue([summary()]);
		mockSave.mockResolvedValue({ ...summary(), document: lowerThird });
		mockUpdate.mockResolvedValue({ ...summary(), name: 'Renamed', document: lowerThird });
		mockPlace.mockResolvedValue({
			screen: { id: 3 },
			graphic: { ...lowerThird, id: 'placed-copy' },
		});
	});

	it('browses the installation library', async () => {
		const wrapper = await mountLibrary();

		expect(mockList).toHaveBeenCalled();
		const entry = wrapper.get('[data-template-id="template-1"]');
		// An author may rename in place, so the name is an editable field rather than text.
		expect(entry.get<HTMLInputElement>('[data-testid="template-name"]').element.value)
			.toBe('Lower third');
		expect(entry.text()).toContain('4 items');
	});

	it('saves the selected Broadcast Graphic as a template', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-library-save"]').trigger('click');
		await flushPromises();

		expect(mockSave).toHaveBeenCalledWith({ eventId: 7, screenId: 3, graphicId: 'placed-lower-third' });
		// The library is re-read, so the author sees the entry they just created.
		expect(mockList).toHaveBeenCalledTimes(2);
	});

	it('offers no save while no Broadcast Graphic is selected', async () => {
		const wrapper = await mountLibrary({ selectedGraphic: null });

		expect(wrapper.get('[data-testid="template-library-save"]').attributes('disabled')).toBeDefined();
	});

	it('places a template and reports the copy it created', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-place"]').trigger('click');
		await flushPromises();

		expect(mockPlace).toHaveBeenCalledWith({ eventId: 7, screenId: 3, templateId: 'template-1' });
		// The Screen was written server-side, so the authoritative Screen is reloaded
		// rather than guessed at.
		expect(mockGetScreenById).toHaveBeenCalledWith(7, 3);
		expect(wrapper.emitted('placed')).toEqual([['placed-copy']]);
	});

	it('renames a template in the library', async () => {
		const wrapper = await mountLibrary();

		const input = wrapper.get('[data-testid="template-name"]');
		await input.setValue('Main show lower third');
		await input.trigger('change');
		await flushPromises();

		expect(mockUpdate).toHaveBeenCalledWith('template-1', { name: 'Main show lower third' });
	});

	it('removes a template from the library', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-delete"]').trigger('click');
		await flushPromises();

		expect(mockRemove).toHaveBeenCalledWith('template-1');
	});

	it('browses read-only without offering any authoring action', async () => {
		const wrapper = await mountLibrary({ writable: false });

		expect(wrapper.get('[data-template-id="template-1"]').text()).toContain('Lower third');
		expect(wrapper.find('[data-testid="template-library-save"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-place"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-delete"]').exists()).toBe(false);
	});

	it('reports a refused placement instead of leaving the author guessing', async () => {
		mockPlace.mockRejectedValue({ data: { message: 'Another session holds the Graphics Authoring Lease' } });
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-place"]').trigger('click');
		await flushPromises();

		expect(wrapper.get('[data-testid="template-library-error"]').text())
			.toContain('Another session holds the Graphics Authoring Lease');
		expect(wrapper.emitted('placed')).toBeUndefined();
	});

	it('shows an empty library as empty rather than as an error', async () => {
		mockList.mockResolvedValue([]);
		const wrapper = await mountLibrary();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No Broadcast Graphic Templates');
	});
});
