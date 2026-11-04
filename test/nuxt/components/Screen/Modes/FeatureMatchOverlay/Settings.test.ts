import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, reactive, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { media } from '~~/test/helpers/graphicsComposition';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { stubPointerCapture } from '~~/test/nuxt/helpers/pointerCapture';
import NumberField from '~/components/Graphics/NumberField.vue';
import PreviewOutputAside from '~/components/Screen/Modes/FeatureMatchOverlay/PreviewOutputAside.vue';
import Settings from '~/components/Screen/Modes/FeatureMatchOverlay/Settings.vue';
import { useEditorFocusMode } from '~/modules/graphics/editorFocusMode';
import { OPACITY_INPUT } from '~/utils/opacityInput';

enableAutoUnmount(afterEach);

const mockConfig = ref(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
/** The Event's canvas, other than the default so a host reading anything else shows. */
const mockEventStore = reactive({
	event: { canvasWidth: 1280, canvasHeight: 720 },
});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});
const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));

const mockFeatureMatchStore = {
	loadFeatureMatchesByEventId: vi.fn().mockResolvedValue(undefined),
};

type ActionListener = (context: { name: string; args: unknown[]; after: (callback: () => void) => void }) => void;
const actionListeners: ActionListener[] = [];

const mockScreenStore = {
	$onAction: vi.fn((listener: ActionListener) => {
		actionListeners.push(listener);
		return () => actionListeners.splice(actionListeners.indexOf(listener), 1);
	}),
};

/** A remote Screen update as the store applies it: listeners run, then the store changes, then `after`. */
function applyRemoteUpdate(screenId: number, change: () => void) {
	const afters: Array<() => void> = [];
	for (const listener of [...actionListeners]) {
		listener({
			name: 'applyRemoteUpdated',
			args: [
				{ eventId: 1, screenId },
			],
			after: callback => afters.push(callback),
		});
	}
	change();
	for (const callback of afters)
		callback();
}

const mockSaveState = ref<'idle' | 'saving' | 'committed' | 'failed'>('idle');
const mockRetry = vi.fn();
const mockResetConfig = vi.fn();
const mockDiscard = vi.fn();
const mockToastAdd = vi.fn();

const mockLeaseWritable = ref(true);
const mockLeaseAsked = ref<{ endpoint: string; enabled: boolean } | null>(null);
const mockTakeOver = vi.fn();
mockNuxtImport('useGraphicsAuthoringLease', () => (options: { endpoint: () => string; enabled?: () => boolean }) => {
	mockLeaseAsked.value = {
		endpoint: options.endpoint(),
		enabled: options.enabled?.() ?? true,
	};
	return {
		lease: ref(null),
		status: ref('ready'),
		writable: mockLeaseWritable,
		heldByAnotherSession: computed(() => !mockLeaseWritable.value),
		holderName: computed(() => mockLeaseWritable.value ? null : 'Marcus Angel'),
		canTakeOver: computed(() => !mockLeaseWritable.value),
		refresh: vi.fn(),
		takeOver: mockTakeOver,
		release: vi.fn(),
	};
});

mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useFeatureMatchMenuItems', () => () => computed(() => [
	{ label: 'Feature Match 1', value: 1 },
]));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	saveState: mockSaveState,
	saveError: ref('Screen refused the layout'),
	updateConfig: mockUpdateConfig,
	resetConfig: mockResetConfig,
	retry: mockRetry,
	discard: mockDiscard,
}));
mockNuxtImport('useToast', () => () => ({ add: mockToastAdd }));
mockNuxtImport('$fetch', () => mockApiFetch);

const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, required: false },
	},
	template: '<section data-testid="settings-card"><h2>{{ title }}</h2><slot /></section>',
});

const LayerInspectorStub = defineComponent({
	props: {
		selectedTarget: { type: Object, required: true },
		writable: { type: Boolean, required: false },
	},
	emits: ['remove', 'duplicate'],
	template: '<div data-testid="layer-inspector" :data-selected="JSON.stringify(selectedTarget)" :data-writable="String(writable)" />',
});

const LayerListStub = defineComponent({
	props: {
		editor: { type: Object, required: true },
	},
	template: '<div data-testid="layer-list" :data-selection="JSON.stringify(editor.selection.value)" />',
});

const CompositorInspectorStub = defineComponent({
	props: {
		selectedTarget: { type: Object, required: true },
		writable: { type: Boolean, required: false },
	},
	template: '<div data-testid="compositor-inspector" :data-selected="JSON.stringify(selectedTarget)" :data-writable="String(writable)" />',
});

const MultiLayerInspectorStub = defineComponent({
	props: {
		layers: { type: Array, required: true },
		writable: { type: Boolean, required: false },
		groupRefusal: { type: String, required: false },
	},
	emits: ['update', 'group'],
	template: '<div data-testid="multi-layer-inspector" :data-layers="JSON.stringify(layers)" :data-writable="String(writable)" :data-group-refusal="groupRefusal" />',
});

const TemplateLibraryStub = defineComponent({
	props: {
		writable: { type: Boolean, required: false },
	},
	emits: ['placing', 'placed'],
	template: '<div data-testid="template-library" :data-writable="String(writable)" />',
});

const USelectStub = defineComponent({
	props: {
		modelValue: {
			type: [String, Number],
			required: false,
		},
		disabled: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="select" :data-disabled="String(disabled)" />',
});

const PreviewOutputAsideStub = defineComponent({
	props: {
		config: { type: Object, required: true },
		selectedTarget: { type: Object, required: true },
		compositorTarget: { type: Object, required: true },
		canvasWidth: { type: Number, required: true },
		canvasHeight: { type: Number, required: true },
		publicationBlocked: { type: Boolean, required: false },
		publicationBlockReason: { type: String, required: false },
		selectionFrame: { type: Object, required: false },
		lockedBoxes: { type: Array, required: false },
	},
	emits: [
		'selectTarget',
		'selectCompositorTarget',
		'manipulate',
		'rotate',
	],
	template: '<div data-testid="preview-output-aside" :data-locked-boxes="JSON.stringify(lockedBoxes)" :data-selected="JSON.stringify(selectedTarget)" :data-compositor-selected="JSON.stringify(compositorTarget)" :data-frame="JSON.stringify(selectionFrame)" :data-config="JSON.stringify(config)" :data-canvas-width="canvasWidth" :data-canvas-height="canvasHeight" :data-publication-blocked="String(publicationBlocked)" :title="publicationBlockReason" />',
});

const UModalStub = defineComponent({
	props: {
		open: { type: Boolean, required: false },
	},
	template: '<div v-if="open" data-testid="modal"><slot name="content" /></div>',
});

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<div data-testid="form-field"><span><slot name="label">{{ label }}</slot></span><slot /></div>',
});

const UFieldGroupStub = defineComponent({
	template: '<div data-testid="field-group"><slot /></div>',
});

const UButtonStub = defineComponent({
	props: {
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

async function mountComponent(screen: Partial<Screen> = {}, stubs: Record<string, unknown> = {}) {
	return mount(Settings, {
		props: {
			screen: {
				id: 1,
				slug: 'main',
				...screen,
			} as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				ScreenSettingsCard: ScreenSettingsCardStub,
				FeatureMatchOverlayLayerInspector: LayerInspectorStub,
				FeatureMatchOverlayLayerList: LayerListStub,
				FeatureMatchOverlayCompositorInspector: CompositorInspectorStub,
				FeatureMatchOverlayMultiLayerInspector: MultiLayerInspectorStub,
				FeatureMatchOverlayPreviewOutputAside: PreviewOutputAsideStub,
				// The Feature Match Layout Template library reads the installation's
				// library on mount. It has its own suite; here it is only a neighbour of
				// the editor under test.
				GraphicsFeatureMatchLayoutTemplateLibrary: TemplateLibraryStub,
				USlideover: { template: '<div><slot name="body" /></div>' },
				UPopover: true,
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
				UAlert: true,
				UModal: UModalStub,
				...stubs,
			},
		},
	});
}

function selectedTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="layer-inspector"]').attributes('data-selected') ?? '{}');
}

function compositorTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-compositor-selected') ?? '{}');
}

function preview(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return wrapper.getComponent(PreviewOutputAsideStub);
}

async function press(key: string, init: KeyboardEventInit = {}) {
	window.dispatchEvent(new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	}));
	await nextTick();
}

function sourceIds() {
	return mockConfig.value.layout.sources.map(source => source.id);
}

function previewSelectedTarget(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-selected') ?? '{}');
}

function previewConfig(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-config') ?? '{}');
}

describe('featureMatchOverlaySettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		mockSaveState.value = 'idle';
		mockLeaseWritable.value = true;
		actionListeners.length = 0;
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({
			outcome: 'available',
			lifecycleState: 'active',
		});
	});

	it('selects a Source Item clicked in the preview, and edits it in the host inspector', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });

		preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
		await nextTick();

		expect(selectedTarget(wrapper)).toEqual({ type: 'source', itemId: 'main-source' });
		expect(previewSelectedTarget(wrapper)).toEqual({ type: 'source', itemId: 'main-source' });
		expect(compositorTarget(wrapper)).toEqual({ type: 'canvas' });
		expect(previewConfig(wrapper).presetId).toBe(mockConfig.value.presetId);
	});

	// ADR-0051: the canvas is the Event's, set in Event Presentation Settings, not here.
	it('authors the layout in the Event Canvas', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-canvas-width')).toBe('1280');
		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-canvas-height')).toBe('720');
	});

	it('visibly blocks output actions while an exact Graphic Asset Reference is missing', async () => {
		mockConfig.value.layout.frame.backgroundImage = {
			kind: 'asset',
			assetId: 'missing-asset',
			revisionId: 'missing-revision',
		} as never;
		mockApiFetch.mockResolvedValue({ outcome: 'missing' });

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.find('[data-testid="graphic-asset-publication-block"]').exists()).toBe(true);
		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-publication-blocked')).toBe('true');
		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('title'))
			.toContain('missing');
	});

	it('retries unavailable Graphic Asset Content without changing the pinned reference', async () => {
		mockConfig.value.layout.frame.backgroundImage = {
			kind: 'asset',
			assetId: 'temporarily-unavailable-asset',
			revisionId: 'pinned-revision',
		} as never;
		mockApiFetch.mockResolvedValue({ outcome: 'unavailable', retryable: true });

		const wrapper = await mountComponent();
		await flushPromises();

		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-publication-blocked')).toBe('true');

		const requestsBeforeRetry = mockApiFetch.mock.calls.length;
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active' });
		await wrapper.get('[data-testid="retry-graphic-asset-publication"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledTimes(requestsBeforeRetry + 1);
		expect(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-publication-blocked')).toBe('false');
		expect(mockConfig.value.layout.frame.backgroundImage).toEqual({
			kind: 'asset',
			assetId: 'temporarily-unavailable-asset',
			revisionId: 'pinned-revision',
		});
	});

	describe('one selection', () => {
		it('edits a Graphic Item chosen in the preview in the shared inspector, and nothing host-owned', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			const itemId = mockConfig.value.layout.composition.items[0]!.id;

			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();
			preview(wrapper).vm.$emit('selectCompositorTarget', { type: 'item', graphicId: 'feature-match-layout', itemId });
			await nextTick();

			expect(wrapper.get('[data-testid="compositor-inspector"]').attributes('data-selected'))
				.toBe(JSON.stringify({ type: 'item', graphicId: 'feature-match-layout', itemId }));
			expect(wrapper.find('[data-testid="layer-inspector"]').exists()).toBe(false);
			expect(previewSelectedTarget(wrapper)).toEqual({ type: 'canvas' });
			expect(JSON.parse(wrapper.get('[data-testid="layer-list"]').attributes('data-selection')!)).toEqual({ type: 'item', itemId });
		});

		it('hands the preview the selected layer\'s rectangle to move', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			const source = mockConfig.value.layout.sources.find(item => item.id === 'main-source')!;

			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();

			expect(JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-frame')!)).toMatchObject({
				rect: {
					x: source.x,
					y: source.y,
					width: source.width,
					height: source.height,
				},
				origin: { x: 0, y: 0 },
			});
		});

		// Every frame of one rotate drag is one undo step.
		it('turns the selected Graphic Item as the preview rotates it, undoing the drag as one step', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			const item = mockConfig.value.layout.composition.items[0]!;
			const rotation = () => mockConfig.value.layout.composition.items.find(candidate => candidate.id === item.id)!.rotation ?? 0;

			preview(wrapper).vm.$emit('selectCompositorTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: item.id });
			await nextTick();
			preview(wrapper).vm.$emit('rotate', 30, 1);
			preview(wrapper).vm.$emit('rotate', 45, 1);
			await nextTick();

			expect(rotation()).toBe(45);
			expect(JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-frame')!)).toMatchObject({ rotation: 45 });

			await press('z', { metaKey: true });
			expect(rotation()).toBe(item.rotation ?? 0);
		});

		it('returns to the canvas when the selected layer leaves the layout', async () => {
			const wrapper = await mountComponent();
			await flushPromises();

			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();
			mockConfig.value = {
				...mockConfig.value,
				layout: {
					...mockConfig.value.layout,
					sources: mockConfig.value.layout.sources.filter(item => item.id !== 'main-source'),
				},
			};
			await nextTick();

			expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });
		});
	});

	// #740: ⌘-click in the preview builds a selection of several, and every verb takes all of it.
	describe('several layers', () => {
		const ITEM_ID = 'player1-game-wins';
		const SELECTED = [
			{ type: 'source', itemId: 'main-source' },
			{ type: 'item', itemId: ITEM_ID },
		];

		async function mountWithTwo() {
			const wrapper = await mountComponent();
			await flushPromises();
			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' }, false);
			await nextTick();
			preview(wrapper).vm.$emit('selectCompositorTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: ITEM_ID }, true);
			await nextTick();
			return wrapper;
		}

		function positions() {
			return [
				mockConfig.value.layout.sources.find(item => item.id === 'main-source'),
				mockConfig.value.layout.composition.items.find(item => item.id === ITEM_ID),
			].map(layer => layer && { x: layer.x, y: layer.y });
		}

		it('shows the multi-layer panel, and no single layer as selected in the preview', async () => {
			const wrapper = await mountWithTwo();

			expect(JSON.parse(wrapper.get('[data-testid="multi-layer-inspector"]').attributes('data-layers')!)).toEqual(SELECTED);
			expect(wrapper.find('[data-testid="layer-inspector"]').exists()).toBe(false);
			expect(wrapper.find('[data-testid="compositor-inspector"]').exists()).toBe(false);
			expect(previewSelectedTarget(wrapper)).toEqual({ type: 'canvas' });
			expect(compositorTarget(wrapper)).toEqual({ type: 'canvas' });
		});

		it('takes a layer out with another ⌘-click', async () => {
			const wrapper = await mountWithTwo();

			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' }, true);
			await nextTick();

			expect(wrapper.find('[data-testid="multi-layer-inspector"]').exists()).toBe(false);
			expect(compositorTarget(wrapper)).toEqual({ type: 'item', graphicId: 'feature-match-layout', itemId: ITEM_ID });
		});

		it('writes an edited shared field to every selected layer', async () => {
			const wrapper = await mountWithTwo();

			wrapper.getComponent(MultiLayerInspectorStub).vm.$emit('update', { y: 40 });
			await nextTick();

			expect(positions().map(position => position?.y)).toEqual([40, 40]);
		});

		it.each<[string, (wrapper: Awaited<ReturnType<typeof mountComponent>>) => Promise<void> | void, { x: number; y: number }]>([
			[
				'an arrow key',
				() => press('ArrowLeft', { shiftKey: true }),
				{ x: -10, y: 0 },
			],
			[
				'a canvas drag of the box they cover',
				(wrapper) => {
					const frame = preview(wrapper).props('selectionFrame') as { rect: { x: number; y: number; width: number; height: number } };
					preview(wrapper).vm.$emit('manipulate', { ...frame.rect, x: frame.rect.x + 5, y: frame.rect.y + 7 }, 1);
				},
				{ x: 5, y: 7 },
			],
		])('moves every one by %s', async (_, act, delta) => {
			const wrapper = await mountWithTwo();
			const before = positions();

			await act(wrapper);
			await nextTick();

			expect(positions()).toEqual(before.map(position => ({ x: position!.x + delta.x, y: position!.y + delta.y })));
		});

		// E8: a Source Item never joins a Graphic Group, and ⌘G says so rather than doing nothing (#920).
		it('says why ⌘G cannot group a selection holding a Source Item, and groups nothing', async () => {
			const wrapper = await mountWithTwo();
			const before = JSON.stringify(mockConfig.value.layout);

			await press('g', { metaKey: true });

			expect(wrapper.get('[data-testid="multi-layer-inspector"]').attributes('data-group-refusal')).toBe('source-item');
			expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ description: 'Source Items can\'t be grouped' }));
			expect(JSON.stringify(mockConfig.value.layout)).toBe(before);
		});

		// The main Source's top is at 90, the Game Wins item's at 278 (#919).
		it('aligns them from the property panel', async () => {
			const wrapper = await mountWithTwo();

			await wrapper.get('[data-testid="layer-align-controls"] button[aria-label="Align top"]').trigger('click');

			expect(positions().map(position => position?.y)).toEqual([90, 90]);
		});

		it('escape keeps the layer chosen last, then selects the canvas', async () => {
			const wrapper = await mountWithTwo();

			await press('Escape');
			expect(wrapper.get('[data-testid="compositor-inspector"]').attributes('data-selected'))
				.toBe(JSON.stringify({ type: 'item', graphicId: 'feature-match-layout', itemId: ITEM_ID }));

			await press('Escape');
			expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });
		});
	});

	describe('whole-layout replacement', () => {
		it('asks before resetting the layout to its preset', async () => {
			const wrapper = await mountComponent();
			await flushPromises();

			await wrapper.get('[data-testid="reset-preset"]').trigger('click');

			expect(mockUpdateConfig).not.toHaveBeenCalled();
			expect(wrapper.get('[data-testid="modal"]').text()).toContain('Reset to preset?');

			await wrapper.get('[data-testid="confirm-preset"]').trigger('click');

			expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
			expect(wrapper.find('[data-testid="modal"]').exists()).toBe(false);
		});

		it('can undo a preset reset', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			mockConfig.value = {
				...mockConfig.value,
				layout: { ...mockConfig.value.layout, sources: [] },
			};
			await nextTick();

			await wrapper.get('[data-testid="reset-preset"]').trigger('click');
			await wrapper.get('[data-testid="confirm-preset"]').trigger('click');
			expect(sourceIds().length).toBeGreaterThan(0);

			await wrapper.get('[data-testid="layout-undo"]').trigger('click');

			expect(sourceIds()).toEqual([]);
		});
	});

	describe('number field scrubs', () => {
		/** A property panel holding one real number field: the Frame's opacity. */
		const FrameOpacityPanelStub = defineComponent({
			components: { GraphicsNumberField: NumberField },
			props: {
				config: { type: Object, required: true },
				updateConfig: { type: Function, required: true },
			},
			setup: () => ({ OPACITY_INPUT }),
			template: `<GraphicsNumberField
				label="Opacity"
				v-bind="OPACITY_INPUT"
				:model-value="config.layout.frame.opacity"
				@update:model-value="opacity => updateConfig({ layout: { ...config.layout, frame: { ...config.layout.frame, opacity } } })"
			/>`,
		});

		beforeAll(stubPointerCapture);

		it('undoes a whole drag on a panel\'s number label as one step, however long it pauses', async () => {
			let now = 1_000;
			vi.spyOn(Date, 'now').mockImplementation(() => now);
			const wrapper = await mountComponent({}, { FeatureMatchOverlayLayerInspector: FrameOpacityPanelStub });
			await flushPromises();
			const start = mockConfig.value.layout.frame.opacity;
			const label = wrapper.get('[data-number-scrub]');

			await label.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 0 });
			for (const clientX of [-2, -4, -6]) {
				now += 1_000;
				await label.trigger('pointermove', { pointerId: 1, clientX });
			}
			await label.trigger('pointerup', { pointerId: 1 });
			expect(mockConfig.value.layout.frame.opacity).toBeCloseTo(start - 0.15);

			await wrapper.get('[data-testid="layout-undo"]').trigger('click');
			expect(mockConfig.value.layout.frame.opacity).toBe(start);
		});
	});

	describe('keyboard', () => {
		it('deletes, undoes, and redoes the selected layer', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			const before = sourceIds();

			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();
			await press('Delete');

			expect(sourceIds()).toEqual(before.filter(id => id !== 'main-source'));
			expect(selectedTarget(wrapper)).toEqual({ type: 'canvas' });

			await press('z', { metaKey: true });
			expect(sourceIds()).toEqual(before);

			await press('z', { metaKey: true, shiftKey: true });
			expect(sourceIds()).toEqual(before.filter(id => id !== 'main-source'));
		});

		it('duplicates the selected layer and selects the copy', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			const before = sourceIds();

			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();
			await press('d', { metaKey: true });

			const copyId = sourceIds().find(id => !before.includes(id));
			expect(copyId).toBeDefined();
			expect(selectedTarget(wrapper)).toEqual({ type: 'source', itemId: copyId });
		});

		it.each<[string, (wrapper: Awaited<ReturnType<typeof mountComponent>>) => Promise<void> | void]>([
			[
				'⌘G',
				() => press('g', { metaKey: true }),
			],
			[
				'the multi-layer panel\'s Group',
				wrapper => wrapper.getComponent(MultiLayerInspectorStub).vm.$emit('group'),
			],
		])('groups two Graphic Items with %s, and ⌘⇧G ungroups them', async (_, group) => {
			const wrapper = await mountComponent();
			await flushPromises();
			const before = mockConfig.value.layout.composition.items;
			preview(wrapper).vm.$emit('selectCompositorTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: 'player1-game-wins' });
			await nextTick();
			preview(wrapper).vm.$emit('selectCompositorTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: 'player2-game-wins' }, true);
			await nextTick();

			await group(wrapper);
			await nextTick();
			const created = mockConfig.value.layout.composition.items.find(item => !before.some(entry => entry.id === item.id));
			expect(created?.type === 'group' && created.children.map(child => child.id)).toEqual(['player1-game-wins', 'player2-game-wins']);
			expect(compositorTarget(wrapper)).toEqual({ type: 'item', graphicId: 'feature-match-layout', itemId: created!.id });

			await press('G', { metaKey: true, shiftKey: true });
			expect(mockConfig.value.layout.composition.items.map(item => item.id)).toEqual(before.map(item => item.id));
		});

		it('copies the selected layer with ⌘C, even for an observer, and pastes a selected copy with ⌘V', async () => {
			localStorage.clear();
			mockLeaseWritable.value = false;
			const wrapper = await mountComponent();
			await flushPromises();
			const before = sourceIds();
			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();

			await press('c', { metaKey: true, code: 'KeyC' });
			await press('v', { metaKey: true, code: 'KeyV' });
			await flushPromises();
			expect(sourceIds()).toEqual(before);

			mockLeaseWritable.value = true;
			await nextTick();
			await press('v', { metaKey: true, code: 'KeyV' });
			await flushPromises();

			const copyId = sourceIds().find(id => !before.includes(id));
			expect(copyId).toBeDefined();
			expect(selectedTarget(wrapper)).toEqual({ type: 'source', itemId: copyId });
		});

		it('refuses a paste naming the layers whose Graphic Asset is no longer selectable (E25)', async () => {
			localStorage.clear();
			mockConfig.value = {
				...mockConfig.value,
				layout: {
					...mockConfig.value.layout,
					composition: {
						...mockConfig.value.layout.composition,
						items: [
							media('Sponsor logo'),
						],
					},
				},
			};
			const wrapper = await mountComponent();
			await flushPromises();
			preview(wrapper).vm.$emit('selectCompositorTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: 'Sponsor logo' });
			await nextTick();
			await press('c', { metaKey: true, code: 'KeyC' });
			mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'retired', kind: 'image' });
			mockUpdateConfig.mockClear();

			await press('v', { metaKey: true, code: 'KeyV' });
			await flushPromises();

			expect(mockUpdateConfig).not.toHaveBeenCalled();
			expect(mockToastAdd).toHaveBeenLastCalledWith(expect.objectContaining({
				title: 'Nothing pasted',
				description: expect.stringContaining('"Sponsor logo"'),
			}));
		});

		it('nudges the selected layer, ten pixels with Shift', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			const start = mockConfig.value.layout.sources.find(item => item.id === 'main-source')!;

			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();
			await press('ArrowRight');
			await press('ArrowDown', { shiftKey: true });

			expect(mockConfig.value.layout.sources.find(item => item.id === 'main-source')).toMatchObject({
				x: start.x + 1,
				y: start.y + 10,
			});
		});

		it('leaves keys alone while the author is typing', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			const before = sourceIds();
			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();

			const input = document.createElement('input');
			document.body.appendChild(input);
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
			input.remove();
			await nextTick();

			expect(sourceIds()).toEqual(before);
		});
	});

	describe('other sessions and saving', () => {
		async function deleteMainSource(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
			await nextTick();
			await press('Delete');
		}

		it('clears undo history when another session changes the layout', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			await deleteMainSource(wrapper);
			expect(wrapper.get('[data-testid="layout-undo"]').attributes('disabled')).toBeUndefined();

			applyRemoteUpdate(1, () => {
				mockConfig.value = {
					...mockConfig.value,
					layout: {
						...mockConfig.value.layout,
						frame: { ...mockConfig.value.layout.frame, opacity: 0.5 },
					},
				};
			});
			await nextTick();

			expect(wrapper.get('[data-testid="layout-undo"]').attributes('disabled')).toBeDefined();
			expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Layout changed elsewhere' }));
		});

		it('keeps undo history through a remote update that leaves the layout alone, or names another Screen', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			await deleteMainSource(wrapper);

			applyRemoteUpdate(1, () => {});
			applyRemoteUpdate(2, () => {
				mockConfig.value = {
					...mockConfig.value,
					layout: { ...mockConfig.value.layout, sources: [] },
				};
			});
			await nextTick();

			expect(wrapper.get('[data-testid="layout-undo"]').attributes('disabled')).toBeUndefined();
			expect(mockToastAdd).not.toHaveBeenCalled();
		});

		it('says whether the layout is saved, and offers a retry when it is not', async () => {
			const wrapper = await mountComponent();
			await flushPromises();
			expect(wrapper.find('[data-testid="layout-save-state"]').exists()).toBe(false);

			mockSaveState.value = 'committed';
			await nextTick();
			expect(wrapper.get('[data-testid="layout-save-state"]').text()).toContain('Saved');

			mockSaveState.value = 'failed';
			await nextTick();
			expect(wrapper.get('[data-testid="layout-save-state"]').attributes('title')).toBe('Screen refused the layout');
			await wrapper.get('[data-testid="layout-save-retry"]').trigger('click');
			expect(mockRetry).toHaveBeenCalledTimes(1);
		});
	});
});

// One Graphics Authoring Lease covers the Screen's Edit workspace, taken on opening the editor (#738).
describe('featureMatchOverlaySettings — Graphics Authoring Lease', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		mockSaveState.value = 'idle';
		actionListeners.length = 0;
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active' });
		mockLeaseWritable.value = false;
	});

	async function mountObserver() {
		const wrapper = await mountComponent();
		await flushPromises();
		preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
		await nextTick();
		return wrapper;
	}

	it('asks for the Screen\'s Edit-workspace lease as soon as the editor opens', async () => {
		await mountComponent();

		expect(mockLeaseAsked.value).toEqual({ endpoint: '/api/events/1/screens/1/graphics-authoring-lease', enabled: true });
	});

	it('shows an observer who holds the lease, and takes it over on request', async () => {
		const wrapper = await mountObserver();

		expect(wrapper.get('[data-testid="edit-lease-notice"]').text()).toContain('Marcus Angel');
		await wrapper.get('[data-testid="edit-lease-take-over"]').trigger('click');

		expect(mockTakeOver).toHaveBeenCalledTimes(1);
	});

	it.each<[string, (wrapper: Awaited<ReturnType<typeof mountComponent>>) => Promise<void> | void]>([
		[
			'delete key',
			() => press('Delete'),
		],
		[
			'canvas move',
			wrapper => preview(wrapper).vm.$emit('manipulate', { x: 1, y: 2, width: 3, height: 4 }, 1),
		],
		[
			'display reset',
			wrapper => (wrapper.vm as unknown as { resetConfig: () => void }).resetConfig(),
		],
	])('writes nothing from the %s', async (_, act) => {
		const wrapper = await mountObserver();

		await act(wrapper);
		await nextTick();

		expect(mockUpdateConfig).not.toHaveBeenCalled();
		expect(mockResetConfig).not.toHaveBeenCalled();
	});

	it('leaves an observer\'s editing shortcuts to the browser', async () => {
		await mountObserver();
		const undo = new KeyboardEvent('keydown', {
			key: 'z',
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});

		window.dispatchEvent(undo);

		expect(undo.defaultPrevented).toBe(false);
	});

	it('drops the unsaved layout when the lease is lost', async () => {
		mockLeaseWritable.value = true;
		await mountComponent();
		await flushPromises();

		mockLeaseWritable.value = false;
		await nextTick();

		expect(mockDiscard).toHaveBeenCalledWith(['layout', 'presetId']);
	});

	it('hands every other write path a read-only state', async () => {
		const wrapper = await mountObserver();

		expect(preview(wrapper).props('selectionFrame')).toBeNull();
		expect(wrapper.get('[data-testid="layer-inspector"]').attributes('data-writable')).toBe('false');
		expect(wrapper.get('[data-testid="template-library"]').attributes('data-writable')).toBe('false');
		expect(wrapper.get('[data-testid="reset-preset"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-testid="layout-undo"]').attributes('disabled')).toBeDefined();
		expect((wrapper.vm as unknown as { resetBlocked: boolean }).resetBlocked).toBe(true);

		preview(wrapper).vm.$emit('selectCompositorTarget', { type: 'item', graphicId: 'feature-match-layout', itemId: mockConfig.value.layout.composition.items[0]!.id });
		await nextTick();
		expect(wrapper.get('[data-testid="compositor-inspector"]').attributes('data-writable')).toBe('false');
	});

	// The stress preview writes nothing, so an observer judges overflow too.
	it('leaves the preview\'s stress toggle working for an observer', async () => {
		const wrapper = await mountComponent({}, {
			FeatureMatchOverlayPreviewOutputAside: false,
			GraphicsCanvasManipulationOverlay: true,
			// The real preview panel, whose toolbar is its card's actions.
			ScreenSettingsCard: { template: '<section><slot name="actions" :open="true" /><slot /></section>' },
		});
		await flushPromises();
		const toggle = wrapper.get('[data-testid="preview-stress-dataset"]');

		expect(toggle.attributes('disabled')).toBeUndefined();
		await toggle.trigger('click');

		expect(toggle.attributes('aria-pressed')).toBe('true');
		expect(wrapper.get('iframe').attributes('src')).toContain('stress=1');
		expect(mockUpdateConfig).not.toHaveBeenCalled();
	});

	// The Graphic Animation Preview is not a write path, so the lease never gates it.
	it('lets an observer play a Graphic Animation Preview run, writing nothing', async () => {
		const wrapper = await mountComponent({}, {
			...nuxtUiStubs,
			UButton: UButtonStub,
			UPopover: true,
			FeatureMatchOverlayPreviewOutputAside: PreviewOutputAside,
			GraphicsCanvasManipulationOverlay: true,
		});
		await flushPromises();
		const postMessage = vi.fn();
		Object.defineProperty(wrapper.get('iframe').element, 'contentWindow', {
			configurable: true,
			value: { postMessage },
		});

		const play = wrapper.get('[data-testid="animation-preview-play"]');
		expect(play.attributes('disabled')).toBeUndefined();
		await play.trigger('click');
		await nextTick();

		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'graphics-compositor:preview-animation',
				plan: expect.objectContaining({ run: 1 }),
			}),
			window.location.origin,
		);
		expect(mockUpdateConfig).not.toHaveBeenCalled();
	});

	it('leaves the Feature Match Slot live for an observer', async () => {
		const wrapper = await mountObserver();
		const slotSelect = wrapper.findAllComponents(USelectStub)[0]!;

		expect(slotSelect.props('disabled')).toBe(false);
		slotSelect.vm.$emit('update:modelValue', 1);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ featureMatchId: 1 });
	});
});

// Editor Focus Mode (#744): the Feature Match Overlay editor is an Edit workspace throughout, so
// its toolbar always offers the toggle, and only that toggle exits — Escape stays the editor's own.
describe('featureMatchOverlaySettings — Editor Focus Mode', () => {
	const focusMode = useEditorFocusMode();

	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		mockSaveState.value = 'idle';
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active' });
		mockLeaseWritable.value = true;
		focusMode.enabled.value = false;
	});

	afterEach(() => {
		focusMode.enabled.value = false;
		localStorage.clear();
	});

	it('enters Focus Mode from the toolbar toggle, and Escape does not leave it', async () => {
		const wrapper = await mountComponent();
		await flushPromises();
		const toggle = wrapper.get('[data-testid="overlay-toolbar"] [data-testid="editor-focus-mode-toggle"]');

		await toggle.trigger('click');
		expect(focusMode.active.value).toBe(true);

		preview(wrapper).vm.$emit('selectTarget', { type: 'source', itemId: 'main-source' });
		await nextTick();
		await press('Escape');

		expect(focusMode.active.value).toBe(true);

		await toggle.trigger('click');
		expect(focusMode.active.value).toBe(false);
	});

	it('gives the page back when the editor closes, keeping the choice', async () => {
		const wrapper = await mountComponent();
		await flushPromises();
		await wrapper.get('[data-testid="editor-focus-mode-toggle"]').trigger('click');

		wrapper.unmount();

		expect(focusMode.active.value).toBe(false);
		expect(focusMode.enabled.value).toBe(true);
	});
});

describe('featureMatchOverlaySettings — Layer Locks', () => {
	const SOURCE = { type: 'source', itemId: 'main-source' } as const;

	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({ outcome: 'available', lifecycleState: 'active' });
		mockLeaseWritable.value = true;
	});

	function sourceX() {
		return mockConfig.value.layout.sources.find(item => item.id === SOURCE.itemId)!.x;
	}

	function lockState(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
		const aside = wrapper.get('[data-testid="preview-output-aside"]');
		return {
			locked: mockConfig.value.layout.sources.find(item => item.id === SOURCE.itemId)?.locked,
			boxes: JSON.parse(aside.attributes('data-locked-boxes') ?? '[]').length,
			frame: JSON.parse(aside.attributes('data-frame') ?? 'null'),
		};
	}

	async function mountSelectingSource() {
		const wrapper = await mountComponent();
		await flushPromises();
		preview(wrapper).vm.$emit('selectTarget', SOURCE);
		await nextTick();
		return wrapper;
	}

	it('locks the selected layer in the layout with ⌘⇧L: the preview badges it, and arrows leave it', async () => {
		const wrapper = await mountSelectingSource();
		const start = sourceX();

		await press('l', { metaKey: true, shiftKey: true });
		await press('ArrowRight');

		expect(lockState(wrapper)).toEqual({
			locked: true,
			boxes: 1,
			frame: null,
		});
		expect(sourceX()).toBe(start);
	});
});
