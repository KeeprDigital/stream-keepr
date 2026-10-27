import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, reactive, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import Settings from '~/components/Screen/Modes/FeatureMatchOverlay/Settings.vue';
import { useEditorFocusMode } from '~/modules/graphics/editorFocusMode';

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
const mockToastAdd = vi.fn();

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
	resetConfig: vi.fn(),
	retry: mockRetry,
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
	},
	emits: ['remove', 'duplicate'],
	template: '<div data-testid="layer-inspector" :data-selected="JSON.stringify(selectedTarget)" />',
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
	},
	template: '<div data-testid="compositor-inspector" :data-selected="JSON.stringify(selectedTarget)" />',
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
	},
	emits: ['selectTarget', 'selectCompositorTarget', 'manipulate'],
	template: '<div data-testid="preview-output-aside" :data-selected="JSON.stringify(selectedTarget)" :data-compositor-selected="JSON.stringify(compositorTarget)" :data-frame="JSON.stringify(selectionFrame)" :data-config="JSON.stringify(config)" :data-canvas-width="canvasWidth" :data-canvas-height="canvasHeight" :data-publication-blocked="String(publicationBlocked)" :title="publicationBlockReason" />',
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
	template: '<div data-testid="form-field"><span>{{ label }}</span><slot /></div>',
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

async function mountComponent(screen: Partial<Screen> = {}) {
	return mount(Settings, {
		props: {
			screen: {
				id: 1,
				slug: 'main',
				screenConfig: {},
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
				FeatureMatchOverlayPreviewOutputAside: PreviewOutputAsideStub,
				// The Feature Match Layout Template library reads the installation's
				// library on mount. It has its own suite; here it is only a neighbour of
				// the editor under test.
				GraphicsFeatureMatchLayoutTemplateLibrary: true,
				USlideover: true,
				UPopover: true,
				UFormField: UFormFieldStub,
				USelect: true,
				UFieldGroup: UFieldGroupStub,
				UButton: UButtonStub,
				UAlert: true,
				UModal: UModalStub,
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

			expect(JSON.parse(wrapper.get('[data-testid="preview-output-aside"]').attributes('data-frame')!)).toEqual({
				rect: {
					x: source.x,
					y: source.y,
					width: source.width,
					height: source.height,
				},
				origin: { x: 0, y: 0 },
			});
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
						frame: { ...mockConfig.value.layout.frame, backgroundColor: '#ff0000' },
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
