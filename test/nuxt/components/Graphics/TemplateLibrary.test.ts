import type { BroadcastGraphicTemplateSummary } from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

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
const mockScreens = ref<Array<{ id: number; stateVersion: number }>>([{ id: 3, stateVersion: 12 }]);

mockNuxtImport('useScreenStore', () => () => ({
	getScreenById: mockGetScreenById,
	get screens() {
		return mockScreens.value;
	},
}));

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
		mockRemove.mockResolvedValue(undefined);
		mockScreens.value = [{ id: 3, stateVersion: 12 }];
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

		// A placement read-modify-writes the Screen's whole stack, so it must state the
		// version it read or the server has nothing to refuse a stale write against.
		expect(mockPlace).toHaveBeenCalledWith({
			eventId: 7,
			screenId: 3,
			templateId: 'template-1',
			stateVersion: 12,
		});
		// The Screen was written server-side, so the authoritative Screen is reloaded
		// rather than guessed at.
		expect(mockGetScreenById).toHaveBeenCalledWith(7, 3);
		expect(wrapper.emitted('placed')).toEqual([['placed-copy']]);
	});

	it('renames a template in the library', async () => {
		const wrapper = await mountLibrary();

		const input = wrapper.get('[data-testid="template-name"]');
		await input.setValue('Main show lower third');
		await flushPromises();

		expect(mockUpdate).toHaveBeenCalledWith('template-1', {
			name: 'Main show lower third',
			revision: 1,
		});
	});

	it('asks before removing a template, and removes it once confirmed', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-delete"]').trigger('click');
		await flushPromises();

		// Deleting a design is irreversible, so the first click asks. The prompt says
		// what an author most needs to know: placed copies survive.
		const prompt = wrapper.get('[data-testid="template-delete-confirm"]');
		expect(prompt.text()).toContain('cannot be undone');
		expect(prompt.text()).toContain('not affected');
		expect(mockRemove).not.toHaveBeenCalled();

		await wrapper.get('[data-testid="template-delete-confirmed"]').trigger('click');
		await flushPromises();

		expect(mockRemove).toHaveBeenCalledWith('template-1');
	});

	it('abandons a deletion that is cancelled', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="template-delete"]').trigger('click');
		await wrapper.get('[data-testid="template-delete-cancelled"]').trigger('click');
		await flushPromises();

		expect(wrapper.find('[data-testid="template-delete-confirm"]').exists()).toBe(false);
		expect(mockRemove).not.toHaveBeenCalled();
	});

	it('describes a template, and clears an emptied description', async () => {
		const wrapper = await mountLibrary();

		const field = wrapper.get('[data-testid="template-description"]');
		await field.setValue('Main show, both casters');
		await flushPromises();

		expect(mockUpdate).toHaveBeenCalledWith('template-1', {
			description: 'Main show, both casters',
			revision: 1,
		});

		mockList.mockResolvedValue([summary({ description: 'Main show, both casters' })]);
		const described = await mountLibrary();
		const clearing = described.get('[data-testid="template-description"]');
		await clearing.setValue('   ');
		await flushPromises();

		// An emptied field clears the description rather than storing whitespace.
		expect(mockUpdate).toHaveBeenLastCalledWith('template-1', { description: null, revision: 1 });
	});

	it('re-reads the library when a revision is refused as stale', async () => {
		mockUpdate.mockRejectedValue({
			data: { message: 'Broadcast Graphic Template has been revised by another session (now revision 4)' },
		});
		const wrapper = await mountLibrary();

		const input = wrapper.get('[data-testid="template-name"]');
		await input.setValue('Renamed against a stale revision');
		await flushPromises();

		expect(wrapper.get('[data-testid="template-library-error"]').text())
			.toContain('revised by another session');
		// Re-read, so the author is looking at the revision that actually exists before
		// they try again.
		// One edit, one write, and one re-read: the library is re-listed so the author is
		// looking at the revision that actually exists before trying again.
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledTimes(2);
	});

	it('browses read-only without offering any authoring action', async () => {
		const wrapper = await mountLibrary({ writable: false });

		expect(wrapper.get('[data-template-id="template-1"]').text()).toContain('Lower third');
		expect(wrapper.find('[data-testid="template-library-save"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-place"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-delete"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-name"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="template-description"]').exists()).toBe(false);
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
