<script setup lang="ts">
import type { GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayPresetId } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { FeatureMatchOverlaySelectionTarget, Screen } from '~/types';
import { useEventListener } from '@vueuse/core';
import { applyFeatureMatchOverlayPreset, FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT, DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH } from '~~/shared/types/screenConfig';
import { useFeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';
import { useConsumedEventData } from '~/modules/event-data/resync';
import {
	CANVAS_SELECTION,
	compositorSelectionTarget,
	editorSelectionFrame,
	editorSelectionLabel,
	fromCompositorSelectionTarget,
	fromHostSelectionTarget,
	hostSelectionTarget,
} from '~/modules/feature-match-overlay/editorSelection';
import FeatureMatchOverlayCompositorInspector from './CompositorInspector.vue';
import FeatureMatchOverlayLayerInspector from './LayerInspector.vue';
import FeatureMatchOverlayLayerList from './LayerList.vue';
import FeatureMatchOverlayPreviewOutputAside from './PreviewOutputAside.vue';

const props = defineProps<{ screen: Screen; eventId: number }>();

const featureMatchStore = useFeatureMatchStore();
const screenStore = useScreenStore();

const {
	screenConfig,
	saving: screenConfigSaving,
	updateScreenConfig,
} = useScreenConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
);

const { config, saving, saveState, saveError, updateConfig, resetConfig, retry: retrySave } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'feature-match-overlay',
);

const settingsSaving = computed(() => saving.value || screenConfigSaving.value);
const {
	eligibility: assetPublicationEligibility,
	blocked: assetPublicationBlocked,
	reason: assetPublicationBlockReason,
	retry: retryAssetPublicationEligibility,
} = useGraphicAssetPublicationEligibility(config);

defineExpose({ resetConfig, saving: settingsSaving });

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots']);

onMounted(async () => {
	await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
	if (!props.screen.screenConfig?.width || !props.screen.screenConfig?.height) {
		await screenStore.updateScreenConfig(props.eventId, props.screen.id, {
			width: props.screen.screenConfig?.width ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
			height: props.screen.screenConfig?.height ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
		});
	}
});

const matchOptions = useFeatureMatchMenuItems();
const presetOptions = FEATURE_MATCH_OVERLAY_PRESETS.map(preset => ({ label: preset.label, value: preset.id, description: preset.description }));
const screenWidth = computed(() => screenConfig.value.width ?? props.screen.screenConfig?.width ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH);
const screenHeight = computed(() => screenConfig.value.height ?? props.screen.screenConfig?.height ?? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT);
const selectedPreset = computed(() => FEATURE_MATCH_OVERLAY_PRESETS.find(preset => preset.id === config.value.presetId));
const aspectMismatch = computed(() => {
	if (!selectedPreset.value)
		return false;
	const actual = screenWidth.value / screenHeight.value;
	return Math.abs(actual - selectedPreset.value.aspectRatio) > 0.05;
});

function updateCanvasDimension(field: 'width' | 'height', value: number | null | undefined) {
	updateScreenConfig({
		[field]: value ?? (field === 'width' ? DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH : DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT),
	});
}

/* ────────────────────────────────────────────────
 * The editor: one selection, one history
 * ──────────────────────────────────────────────── */

const editor = useFeatureMatchLayoutEditor({
	config,
	updateConfig,
	canvasWidth: screenWidth,
	canvasHeight: screenHeight,
});
const { selection } = editor;

/** The selection in the host-owned vocabulary the Frame and Source Item editors speak. */
const selectedTarget = computed(() => hostSelectionTarget(selection.value));
/** The selection in the shared compositor's vocabulary its inspector and guides speak. */
const compositorTarget = computed(() => compositorSelectionTarget(selection.value));

function selectHostTarget(target: FeatureMatchOverlaySelectionTarget) {
	editor.select(fromHostSelectionTarget(target));
}

function selectCompositorTarget(target: GraphicsSelectionTarget) {
	editor.select(fromCompositorSelectionTarget(target));
}

const selectionFrame = computed(() => editorSelectionFrame(config.value.layout, selection.value));
const selectionLabel = computed(() => editorSelectionLabel(config.value.layout, selection.value));

function manipulate(rect: GraphicRect, gesture: number) {
	editor.setRect(selection.value, rect, { coalesce: `canvas:${gesture}` });
}

/**
 * Someone else's change to this layout ends the undo history.
 *
 * A remote Screen update reaches this client only when another session wrote it
 * — this one's own echo is suppressed — and every undo step is a whole earlier
 * layout, so undoing past their change would silently discard it. Only a change
 * to the layout itself counts; a colleague switching some other setting leaves
 * the history alone. The editor takes no Graphics Authoring Lease, so this is
 * the guard against two authors undoing over each other, not against two
 * authors editing at once.
 */
const toast = useToast();
const stopWatchingRemoteUpdates = screenStore.$onAction(({ name, args, after }) => {
	if (name !== 'applyRemoteUpdated' || (args[0] as { screenId?: number } | undefined)?.screenId !== props.screen.id)
		return;
	const before = JSON.stringify(config.value.layout);
	after(() => {
		if (JSON.stringify(config.value.layout) === before || !editor.discardHistory())
			return;
		toast.add({
			title: 'Layout changed elsewhere',
			description: 'Another session edited this layout, so undo history was cleared to keep their change.',
			color: 'info',
		});
	});
});
onBeforeUnmount(stopWatchingRemoteUpdates);

/** Property panel edits: undoable, one step per burst of typing. */
function updateFields(partial: Partial<FeatureMatchOverlayModeConfig>) {
	editor.editFields(partial);
}

/* ────────────────────────────────────────────────
 * Whole-layout actions
 * ──────────────────────────────────────────────── */

/** A whole-layout replacement awaiting confirmation: a different preset, or the current one again. */
const pendingPreset = ref<{ id: FeatureMatchOverlayPresetId; reset: boolean } | null>(null);

const showPresetConfirm = computed({
	get: () => pendingPreset.value !== null,
	set: (value: boolean) => {
		if (!value)
			pendingPreset.value = null;
	},
});

function askToApplyPreset(id: FeatureMatchOverlayPresetId) {
	pendingPreset.value = { id, reset: id === config.value.presetId };
}

function applyPreset() {
	const pending = pendingPreset.value;
	if (!pending)
		return;
	editor.edit(applyFeatureMatchOverlayPreset(config.value, pending.id));
	editor.select(CANVAS_SELECTION);
	pendingPreset.value = null;
}

const templatesOpen = ref(false);

function templatePlaced() {
	editor.select(CANVAS_SELECTION);
	templatesOpen.value = false;
}

/* ────────────────────────────────────────────────
 * Keyboard
 * ──────────────────────────────────────────────── */

const SHORTCUTS = [
	{ keys: ['⌘', 'Z'], label: 'Undo' },
	{ keys: ['⌘', '⇧', 'Z'], label: 'Redo' },
	{ keys: ['⌘', 'D'], label: 'Duplicate' },
	{ keys: ['⌫'], label: 'Delete' },
	{ keys: ['←↑↓→'], label: 'Nudge 1px (⇧ 10px)' },
	{ keys: ['⌘', ']'], label: 'Bring forward (⇧ to front)' },
	{ keys: ['⌘', '['], label: 'Send backward (⇧ to back)' },
	{ keys: ['⌘', '⇧', 'H'], label: 'Hide or show' },
	{ keys: ['F2'], label: 'Rename the focused layer (or double-click it)' },
	{ keys: ['Esc'], label: 'Select canvas' },
	{ keys: ['⇧ drag'], label: 'Keep aspect ratio' },
	{ keys: ['⌥ drag'], label: 'Turn off snapping' },
] as const;

/** Whether a key press belongs to something the author is typing into or choosing in. */
function isTypingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement))
		return false;
	if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
		return true;
	return target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

const NUDGE: Record<string, { x: number; y: number }> = {
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
};

function handleKeydown(event: KeyboardEvent) {
	if (event.defaultPrevented || isTypingTarget(event.target) || pendingPreset.value || templatesOpen.value)
		return;

	const mod = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();
	const current = selection.value;
	let handled = true;

	if (mod && key === 'z' && !event.shiftKey) {
		editor.undo();
	}
	else if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) {
		editor.redo();
	}
	else if (mod && key === 'd') {
		editor.duplicate();
	}
	else if (mod && (event.code === 'BracketRight' || event.code === 'BracketLeft')) {
		const forward = event.code === 'BracketRight';
		if (event.shiftKey)
			editor.moveToEdge(current, forward ? 'front' : 'back');
		else
			editor.move(current, forward ? 1 : -1);
	}
	else if (mod && event.shiftKey && key === 'h') {
		editor.toggleVisible();
	}
	else if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
		editor.remove();
	}
	else if (!mod && event.key in NUDGE && current.type !== 'canvas') {
		const step = event.shiftKey ? 10 : 1;
		const direction = NUDGE[event.key]!;
		editor.nudge({ x: direction.x * step, y: direction.y * step });
	}
	else if (event.key === 'Escape' && current.type !== 'canvas') {
		editor.select(CANVAS_SELECTION);
	}
	else {
		handled = false;
	}

	if (handled)
		event.preventDefault();
}

useEventListener(import.meta.client ? window : undefined, 'keydown', handleKeydown);
</script>

<template>
	<div class="space-y-4">
		<section class="rounded-lg border border-default/70 bg-default p-3" data-testid="overlay-toolbar">
			<div class="flex flex-wrap items-end gap-3">
				<UFormField label="Feature Match Slot" size="sm" class="min-w-56 flex-1">
					<USelect
						:model-value="config.featureMatchId ?? undefined"
						:items="matchOptions"
						value-key="value"
						placeholder="Select a slot..."
						class="w-full"
						@update:model-value="updateConfig({ featureMatchId: $event })"
					/>
				</UFormField>
				<UFormField label="Preset" size="sm" class="min-w-64 flex-1">
					<UFieldGroup class="w-full">
						<USelect
							:model-value="config.presetId"
							:items="presetOptions"
							value-key="value"
							class="min-w-0 flex-1"
							@update:model-value="askToApplyPreset($event)"
						/>
						<UButton
							size="sm"
							variant="soft"
							color="neutral"
							icon="i-lucide-rotate-ccw"
							data-testid="reset-preset"
							title="Reset the layout to this preset"
							@click="askToApplyPreset(config.presetId)"
						>
							Reset
						</UButton>
					</UFieldGroup>
				</UFormField>
				<UFormField label="Canvas size" size="sm" class="w-64">
					<UFieldGroup class="w-full">
						<UInputNumber
							:model-value="screenWidth"
							:placeholder="String(DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH)"
							:min="1"
							size="sm"
							class="min-w-0 flex-1"
							aria-label="Canvas width"
							@update:model-value="updateCanvasDimension('width', $event)"
						/>
						<UInputNumber
							:model-value="screenHeight"
							:placeholder="String(DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT)"
							:min="1"
							size="sm"
							class="min-w-0 flex-1"
							aria-label="Canvas height"
							@update:model-value="updateCanvasDimension('height', $event)"
						/>
					</UFieldGroup>
				</UFormField>

				<div class="ml-auto flex items-center gap-1">
					<div
						v-if="saveState !== 'idle'"
						class="mr-1 flex items-center gap-1.5 text-xs"
						:class="saveState === 'failed' ? 'text-error' : 'text-muted'"
						:title="saveState === 'failed' ? (saveError ?? undefined) : undefined"
						role="status"
						data-testid="layout-save-state"
						:data-save-state="saveState"
					>
						<template v-if="saveState === 'saving'">
							<UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
							Saving…
						</template>
						<template v-else-if="saveState === 'committed'">
							<UIcon name="i-lucide-check" class="size-3.5 text-success" />
							Saved
						</template>
						<template v-else>
							<UIcon name="i-lucide-triangle-alert" class="size-3.5" />
							Not saved
							<UButton
								size="xs"
								color="error"
								variant="soft"
								icon="i-lucide-rotate-cw"
								data-testid="layout-save-retry"
								@click="retrySave()"
							>
								Retry
							</UButton>
						</template>
					</div>
					<UFieldGroup size="sm">
						<UButton
							variant="soft"
							color="neutral"
							icon="i-lucide-undo-2"
							:disabled="!editor.canUndo.value"
							aria-label="Undo"
							title="Undo (⌘Z)"
							data-testid="layout-undo"
							@click="editor.undo()"
						/>
						<UButton
							variant="soft"
							color="neutral"
							icon="i-lucide-redo-2"
							:disabled="!editor.canRedo.value"
							aria-label="Redo"
							title="Redo (⌘⇧Z)"
							data-testid="layout-redo"
							@click="editor.redo()"
						/>
					</UFieldGroup>
					<UButton
						size="sm"
						variant="soft"
						color="neutral"
						icon="i-lucide-layout-template"
						data-testid="layout-templates-open"
						@click="templatesOpen = true"
					>
						Templates
					</UButton>
					<UPopover>
						<UButton
							size="sm"
							variant="ghost"
							color="neutral"
							icon="i-lucide-keyboard"
							aria-label="Keyboard shortcuts"
							title="Keyboard shortcuts"
						/>
						<template #content>
							<div class="w-72 space-y-1.5 p-3 text-sm">
								<p class="mb-2 font-medium">
									Keyboard shortcuts
								</p>
								<div v-for="shortcut in SHORTCUTS" :key="shortcut.label" class="flex items-center justify-between gap-3">
									<span class="text-muted">{{ shortcut.label }}</span>
									<span class="flex gap-0.5">
										<UKbd
											v-for="key in shortcut.keys"
											:key="key"
											:value="key"
											size="sm"
										/>
									</span>
								</div>
							</div>
						</template>
					</UPopover>
					<!-- This editor has no Live workspace, so Editor Focus Mode is always on offer (#744). -->
					<GraphicsEditorFocusModeToggle />
				</div>
			</div>

			<UAlert
				v-if="aspectMismatch"
				class="mt-3"
				color="warning"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Preset aspect ratio mismatch"
				description="This preset was designed for 16:9. You can still use it, but geometry may need adjustment."
			/>
			<UAlert
				v-if="assetPublicationBlocked"
				data-testid="graphic-asset-publication-block"
				class="mt-3"
				:color="assetPublicationEligibility.outcome === 'missing' ? 'error' : 'warning'"
				variant="soft"
				:title="assetPublicationEligibility.outcome === 'missing'
					? 'Missing Graphic Asset Reference'
					: assetPublicationEligibility.outcome === 'unavailable'
						? 'Unavailable Graphic Asset Content'
						: 'Checking Graphic Asset References'"
				:description="assetPublicationBlockReason"
			/>
			<UButton
				v-if="assetPublicationEligibility.outcome === 'unavailable'"
				data-testid="retry-graphic-asset-publication"
				class="mt-2"
				color="warning"
				variant="soft"
				icon="i-lucide-refresh-cw"
				@click="retryAssetPublicationEligibility"
			>
				Retry Graphic Asset Content
			</UButton>
		</section>

		<div class="grid items-start gap-4 xl:grid-cols-[15rem_minmax(0,1fr)_18rem] 2xl:grid-cols-[19rem_minmax(0,1fr)_24rem]">
			<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<FeatureMatchOverlayLayerList
					:layout="config.layout"
					:editor="editor"
					:canvas-width="screenWidth"
					:canvas-height="screenHeight"
				/>
			</section>

			<section class="min-w-0 xl:sticky xl:top-4">
				<FeatureMatchOverlayPreviewOutputAside
					:event-id="eventId"
					:screen="screen"
					:config="config"
					:selected-target="selectedTarget"
					:compositor-target="compositorTarget"
					:canvas-width="screenWidth"
					:canvas-height="screenHeight"
					:publication-blocked="assetPublicationBlocked"
					:publication-block-reason="assetPublicationBlockReason"
					:selection-frame="selectionFrame"
					:selection-label="selectionLabel"
					fit-height="calc(100vh - 14rem)"
					@select-target="selectHostTarget"
					@select-compositor-target="selectCompositorTarget"
					@manipulate="manipulate"
				/>
			</section>

			<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<FeatureMatchOverlayCompositorInspector
					v-if="selection.type === 'item'"
					:layout="config.layout"
					:selected-target="compositorTarget"
					:canvas-width="screenWidth"
					:canvas-height="screenHeight"
					:event-id="eventId"
					writable
					@update:composition="composition => updateFields({ layout: { ...config.layout, composition } })"
				/>
				<FeatureMatchOverlayLayerInspector
					v-else
					:selected-target="selectedTarget"
					:config="config"
					:update-config="updateFields"
					:screen-width="screenWidth"
					:screen-height="screenHeight"
					:event-id="eventId"
					@remove="itemId => editor.remove({ type: 'source', itemId })"
					@duplicate="itemId => editor.duplicate({ type: 'source', itemId })"
				/>
			</section>
		</div>

		<!--
			The installation's reusable Feature Match Layouts. They act on the whole
			layout — saving copies this Screen's layout out, placing replaces it — so
			they open from the toolbar beside the preset rather than from the layer list.

			Writable unconditionally, which is the honest state rather than an omission:
			the Feature Match Overlay editor takes no Graphics Authoring Lease today, so
			every control on this page is already as writable as this one.
		-->
		<USlideover v-model:open="templatesOpen" title="Layout templates">
			<template #body>
				<GraphicsFeatureMatchLayoutTemplateLibrary
					:event-id="eventId"
					:screen-id="screen.id"
					writable
					bare
					@placing="editor.checkpoint()"
					@placed="templatePlaced"
				/>
			</template>
		</USlideover>

		<UModal v-model:open="showPresetConfirm">
			<template #content>
				<div class="p-6 space-y-4">
					<h3 class="text-lg font-semibold">
						{{ pendingPreset?.reset ? 'Reset to preset?' : 'Apply preset?' }}
					</h3>
					<p class="text-sm text-muted">
						This replaces the Frame, every Source Item, and every Graphic Item with the preset's,
						keeping the selected Feature Match Slot. You can undo it.
					</p>
					<div class="flex justify-end gap-2">
						<UButton variant="soft" color="neutral" @click="() => { pendingPreset = null }">
							Cancel
						</UButton>
						<UButton color="primary" data-testid="confirm-preset" @click="applyPreset">
							{{ pendingPreset?.reset ? 'Reset' : 'Apply' }}
						</UButton>
					</div>
				</div>
			</template>
		</UModal>
	</div>
</template>
