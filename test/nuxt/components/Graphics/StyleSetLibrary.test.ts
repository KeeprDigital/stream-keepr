import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetResponse, GraphicStyleSetSummary } from '~~/shared/types/graphicStyleSet';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

/**
 * The Graphic Style Set library as an author operates it.
 *
 * The rules under test are the ones that make a shared style safe to change: linking
 * adopts nothing, publishing reports which templates it reaches without writing one,
 * an unpublished Style Set cannot be linked to, and unlinking keeps every value the
 * Style Set produced.
 */

enableAutoUnmount(afterEach);

const mockList = vi.fn();
const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockPublish = vi.fn();
const mockDeleteEntry = vi.fn();
const mockRemove = vi.fn();

mockNuxtImport('useGraphicStyleSetRepository', () => () => ({
	list: mockList,
	get: mockGet,
	create: mockCreate,
	update: mockUpdate,
	publish: mockPublish,
	deleteEntry: mockDeleteEntry,
	remove: mockRemove,
	reviewTemplateUpdate: vi.fn(),
	applyTemplateUpdate: vi.fn(),
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
	props: { modelValue: { type: [String, Number], default: '' } },
	emits: ['update:modelValue', 'change'],
	template: '<input :value="modelValue" @change="$emit(\'change\', $event)" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
const USelectStub = defineComponent({
	name: 'USelect',
	props: { modelValue: { type: [String, Number, Boolean], default: undefined } },
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
});
const USwitchStub = defineComponent({
	name: 'USwitch',
	props: { modelValue: { type: Boolean, default: false } },
	emits: ['update:modelValue'],
	template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
});
const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<label><span>{{ label }}</span><slot /></label>',
});

const lowerThird: BroadcastGraphicConfig = {
	id: 'placed-lower-third',
	name: 'Lower third',
	items: [
		{
			type: 'text',
			id: 'headline',
			label: 'Headline',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 400,
			height: 60,
			text: 'Now playing',
			typography: {
				fontId: 'inter',
				fontSize: 64,
				fontWeight: 800,
				fontStyle: 'normal',
				textTransform: 'uppercase',
				letterSpacing: 2,
				lineHeight: 1,
				textAlign: 'left',
				color: '#ff0044',
			},
			overflowPolicy: 'shrink',
			minFontSize: 24,
			styleRefs: { typography: { entryId: 'heading' } },
		},
	],
	styleSet: { styleSetId: 'style-1', revision: 3 },
};

function summary(overrides: Partial<GraphicStyleSetSummary> = {}): GraphicStyleSetSummary {
	return {
		id: 'style-1',
		name: 'Show style',
		description: null,
		revision: 3,
		draftRevision: 9,
		entryCount: 5,
		hasUnpublishedChanges: false,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		...overrides,
	};
}

function response(overrides: Partial<GraphicStyleSetResponse> = {}): GraphicStyleSetResponse {
	const brand = {
		id: 'brand',
		kind: 'palette' as const,
		name: 'Brand',
		schemaVersion: 1,
		value: { color: '#ff0044' },
	};
	return { ...summary(), draft: [brand], published: [brand], ...overrides };
}

async function mountLibrary(props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/Graphics/StyleSetLibrary.vue';
	const { default: StyleSetLibrary } = await import(componentPath);

	const wrapper = mount(StyleSetLibrary, {
		props: { selectedGraphic: lowerThird, writable: true, ...props },
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				UIEmptyState: UIEmptyStateStub,
				UAlert: UAlertStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				USelect: USelectStub,
				USwitch: USwitchStub,
				UFormField: UFormFieldStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('graphicsStyleSetLibrary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockList.mockResolvedValue([summary()]);
		mockGet.mockResolvedValue(response());
		mockCreate.mockResolvedValue(response({ id: 'style-2', name: 'New style', revision: 0, published: null }));
		mockUpdate.mockResolvedValue(response({ draftRevision: 10 }));
		mockPublish.mockResolvedValue({
			styleSet: response({ revision: 4, draftRevision: 10 }),
			affectedTemplates: [
				{ id: 'template-1', name: 'Lower third', revision: 6, styleChanged: true },
				{ id: 'template-2', name: 'Slate', revision: 2, styleChanged: false },
			],
		});
		mockDeleteEntry.mockResolvedValue(response());
		mockRemove.mockResolvedValue(undefined);
	});

	it('browses the installation-wide library', async () => {
		const wrapper = await mountLibrary();

		expect(mockList).toHaveBeenCalled();
		const entry = wrapper.get('[data-style-set-id="style-1"]');
		expect(entry.text()).toContain('Show style');
		expect(entry.text()).toContain('5 entries');
		expect(entry.text()).toContain('revision 3');
	});

	it('reports a Style Set with unpublished draft changes', async () => {
		mockList.mockResolvedValue([summary({ hasUnpublishedChanges: true })]);

		const wrapper = await mountLibrary();

		expect(wrapper.find('[data-testid="style-set-unpublished"]').exists()).toBe(true);
	});

	it('links the selected Broadcast Graphic without adopting anything', async () => {
		mockList.mockResolvedValue([summary({ id: 'style-9', name: 'Other style' })]);

		const wrapper = await mountLibrary({
			selectedGraphic: { ...lowerThird, styleSet: undefined },
		});
		await wrapper.get('[data-testid="style-set-link"]').trigger('click');

		const emitted = wrapper.emitted('update:graphic');
		expect(emitted).toHaveLength(1);
		const linked = emitted![0]![0] as BroadcastGraphicConfig;
		expect(linked.styleSet).toEqual({ styleSetId: 'style-9', revision: 3 });
		// Linking records where inherited properties will come from and moves nothing:
		// every property is exactly as local as it was.
		expect(linked.items).toEqual(lowerThird.items);
	});

	it('drops the previous Style Set\'s references when switching the link', async () => {
		mockList.mockResolvedValue([summary({ id: 'style-9', name: 'Other style' })]);

		// Already linked to `style-1`, with an item referencing one of its entries.
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-link"]').trigger('click');

		const switched = wrapper.emitted('update:graphic')![0]![0] as BroadcastGraphicConfig;
		expect(switched.styleSet).toEqual({ styleSetId: 'style-9', revision: 3 });
		// A composition links to at most one Style Set, so a reference to the old one
		// would name an entry the new one has never heard of.
		expect(switched.items[0]).not.toHaveProperty('styleRefs');
		// And nothing it renders moved.
		const headline = switched.items[0];
		expect(headline?.type === 'text' && headline.typography.color).toBe('#ff0044');
	});

	it('will not link to a Style Set that has never been published', async () => {
		mockList.mockResolvedValue([summary({ id: 'style-9', revision: 0 })]);

		const wrapper = await mountLibrary({ selectedGraphic: { ...lowerThird, styleSet: undefined } });

		expect(wrapper.get<HTMLButtonElement>('[data-testid="style-set-link"]').element.disabled).toBe(true);
	});

	it('unlinks by keeping every value and dropping only the provenance', async () => {
		const wrapper = await mountLibrary();

		await wrapper.get('[data-testid="style-set-unlink"]').trigger('click');

		const unlinked = wrapper.emitted('update:graphic')![0]![0] as BroadcastGraphicConfig;
		expect(unlinked.styleSet).toBeUndefined();
		expect(unlinked.items[0]).not.toHaveProperty('styleRefs');
		// Nothing any output renders has changed.
		const headline = unlinked.items[0];
		expect(headline?.type === 'text' && headline.typography.color).toBe('#ff0044');
	});

	it('publishes the draft and names the templates it reaches without writing one', async () => {
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-open"]').trigger('click');
		await flushPromises();

		await wrapper.get('[data-testid="style-set-publish"]').trigger('click');
		await flushPromises();

		expect(mockPublish).toHaveBeenCalledWith('style-1', 9);
		const affected = wrapper.get('[data-testid="style-set-affected"]');
		expect(affected.text()).toContain('1 of 2 linked templates have an update to review');
		expect(affected.text()).toContain('Lower third — update available');
		expect(affected.text()).toContain('Slate — unchanged');
	});

	it('reports every reason a draft cannot be published, together', async () => {
		mockPublish.mockRejectedValue({
			data: {
				message: 'This Graphic Style Set draft cannot be published',
				data: {
					issues: [
						{ code: 'entry-reference-missing', entryId: 'heading', entryName: 'Heading', message: 'Heading references an entry that does not exist' },
						{ code: 'entry-font-unavailable', entryId: 'caption', entryName: 'Caption', message: 'Caption names a font this installation does not have' },
					],
				},
			},
		});

		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-open"]').trigger('click');
		await flushPromises();
		await wrapper.get('[data-testid="style-set-publish"]').trigger('click');
		await flushPromises();

		const reported = wrapper.get('[data-testid="style-set-publish-issues"]');
		expect(reported.text()).toContain('Heading references an entry that does not exist');
		expect(reported.text()).toContain('Caption names a font this installation does not have');
	});

	it('offers replace and detach before an entry is deleted', async () => {
		const wrapper = await mountLibrary();
		await wrapper.get('[data-testid="style-set-open"]').trigger('click');
		await flushPromises();

		await wrapper.get('[data-testid="style-entry-delete"]').trigger('click');
		await flushPromises();

		const confirmation = wrapper.get('[data-testid="style-entry-delete-confirm"]');
		expect(confirmation.text()).toContain('Nothing on air changes either way');
		await confirmation.get('[data-testid="style-entry-delete-detach"]').trigger('click');
		await flushPromises();

		expect(mockDeleteEntry).toHaveBeenCalledWith('style-1', 'brand', {
			mode: 'detach',
			draftRevision: 9,
		});
	});

	it('gives an observer no way to author', async () => {
		const wrapper = await mountLibrary({ writable: false });

		expect(wrapper.find('[data-testid="style-set-create"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="style-set-link"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="style-set-unlink"]').exists()).toBe(false);
	});
});
