<script setup lang="ts">
import type { GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { FeatureMatchOverlaySelectionTarget, Screen } from '~/types';
import { eventCanvasOf } from '~~/shared/eventCanvas';
import { useGraphicsEditor } from '~/composables/useGraphicsEditor';
import { useGraphicsEditorKeyboard } from '~/composables/useGraphicsEditorKeyboard';
import { featureMatchLayoutEditorHost } from '~/modules/feature-match-overlay/editorHost';
import {
	compositorSelectionTarget,
	editorSelectionLabel,
	editorSelectionLayer,
	fromCompositorSelectionTarget,
	fromHostSelectionTarget,
	hostSelectionTarget,
} from '~/modules/feature-match-overlay/editorSelection';
import { CANVAS_SELECTION } from '~/modules/graphics/editor/host';
import { GRAPHICS_EDITOR_SHORTCUTS } from '~/modules/graphics/editor/shortcuts';
import { NUMBER_SCRUB_GESTURE } from '~/modules/graphics/numberScrubGesture';
import FeatureMatchOverlayCompositorInspector from './CompositorInspector.vue';
import FeatureMatchOverlayLayerInspector from './LayerInspector.vue';
import FeatureMatchOverlayLayerList from './LayerList.vue';
import FeatureMatchOverlayPreviewOutputAside from './PreviewOutputAside.vue';

const props = defineProps<{ screen: Screen; eventId: number }>();

/**
 * The Theme the editor previews under (#829): this Screen's Event's, unless the
 * author picks another to see the layout under a different Theme.
 */
const previewEventStore = useEventStore();
const previewTheme = useGraphicsPreviewTheme(() => previewEventStore.event?.themeId);

const screenStore = useScreenStore();
const eventStore = useEventStore();

const { config, saving, saveState, saveError, updateConfig, resetConfig, retry: retrySave, discard, flush } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'feature-match-overlay',
);

/**
 * The Screen's graphics Edit workspace is one leased authoring artifact (ADR-0030),
 * and this editor is that workspace while the Screen is a Feature Match Overlay,
 * so it asks for the lease as soon as it opens (#738). The Feature Match Slot is
 * live operation and never consults it.
 */
const editLease = useGraphicsAuthoringLease({
	endpoint: () => `/api/events/${props.eventId}/screens/${props.screen.id}/graphics-authoring-lease`,
});
const { writable } = editLease;

/**
 * Losing the lease, to another Session or to its deadline, drops this session's
 * unsaved layout, as the Broadcast Graphics editor does (#1100). The fence may
 * refuse it, and kept on screen it would hide the next holder's changes, then be
 * built on.
 */
watch(editLease.lost, (lost) => {
	if (lost)
		discard(['layout']);
});

/**
 * A Feature Match Layout Template placement is in flight. The server is rewriting
 * the layout and the Screen is then reloaded, so an edit made meanwhile would be
 * built on the layout from before the placement and would write the placed one away.
 */
const placing = ref(false);

/** Whether this session may edit now: it holds the lease, and no placement is in flight. */
const canAuthor = computed(() => writable.value && !placing.value);

/** A display reset replaces the layout, so it is an authoring write like any other. */
function resetLayout() {
	if (canAuthor.value)
		resetConfig();
}

const {
	eligibility: assetPublicationEligibility,
	blocked: assetPublicationBlocked,
	reason: assetPublicationBlockReason,
	retry: retryAssetPublicationEligibility,
} = useGraphicAssetPublicationEligibility(config);

defineExpose({
	resetConfig: resetLayout,
	resetBlocked: computed(() => !canAuthor.value),
	saving,
});

/** The overlay is authored in its Event's canvas, set in Event Presentation Settings (ADR-0051). */
const eventCanvas = computed(() => eventCanvasOf(eventStore.event));
const canvasWidth = computed(() => eventCanvas.value.width);
const canvasHeight = computed(() => eventCanvas.value.height);

/* ────────────────────────────────────────────────
 * The editor: one selection of layers, one history
 * ──────────────────────────────────────────────── */

const editor = useGraphicsEditor(featureMatchLayoutEditorHost({
	config,
	updateConfig,
	canvasWidth,
	canvasHeight,
	writable,
	held: placing,
}));
const { selection, layers } = editor;
/** Several layers selected: the panel edits what they share, and the preview marks none alone (#740). */
const severalSelected = computed(() => layers.value.length > 1);

/** The selection in the host-owned vocabulary the Frame and Source Item editors speak. */
const selectedTarget = computed(() => hostSelectionTarget(selection.value));
/** The selection in the shared compositor's vocabulary its inspector and guides speak. */
const compositorTarget = computed(() => compositorSelectionTarget(selection.value));

/** A click in the preview selects that layer alone; a ⌘- or Ctrl-click adds it or takes it out (#740). */
function selectInPreview(target: ReturnType<typeof fromHostSelectionTarget>, toggle: boolean) {
	if (toggle && target.type !== 'canvas')
		editor.toggleSelect(target);
	else
		editor.select(target);
}

function selectHostTarget(target: FeatureMatchOverlaySelectionTarget, toggle = false) {
	selectInPreview(fromHostSelectionTarget(target), toggle);
}

function selectCompositorTarget(target: GraphicsSelectionTarget, toggle = false) {
	selectInPreview(fromCompositorSelectionTarget(target), toggle);
}

/**
 * Where the canvas handles go, with the lines they snap to; none while this
 * session may not move anything, so neither handles nor snap guides show.
 */
const selectionFrame = computed(() => canAuthor.value
	? editor.selectionFrame.value
	: null);
/** Each selected layer's stored rectangle, for the panel that edits several. */
const selectedRects = computed(() => layers.value.flatMap((layer) => {
	const rect = editorSelectionLayer(config.value.layout, layer);
	return rect
		? [rect]
		: [];
}));
const selectionLabel = computed(() => severalSelected.value
	? `${layers.value.length} layers`
	: editorSelectionLabel(config.value.layout, selection.value));

// A canvas drag is bracketed as one gesture below, so it undoes as one step
// however long it pauses; the key coalesces frames arriving outside one.
function manipulate(rect: GraphicRect, gesture: number) {
	editor.setSelectionRect(rect, { coalesce: `canvas:${gesture}` });
}

function rotate(rotation: number, gesture: number) {
	editor.setRotation(selection.value, rotation, { coalesce: `canvas:${gesture}` });
}

/**
 * Someone else's change to this layout ends the undo history.
 *
 * A remote Screen update reaches this client only when another session wrote it
 * — this one's own echo is suppressed — and every undo step is a whole earlier
 * layout, so undoing past their change would silently discard it. Only a change
 * to the layout itself counts; a colleague switching some other setting leaves
 * the history alone. The Graphics Authoring Lease keeps two authors from editing
 * at once, and losing it clears the history too; this covers a write that landed
 * while nobody held it.
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
	editor.commit(() => updateConfig(partial), { coalesce: 'fields' });
}

/** A drag on a property panel's number label undoes as one step, however long it pauses. */
provide(NUMBER_SCRUB_GESTURE, {
	begin: editor.beginGesture,
	end: editor.endGesture,
});

/* ────────────────────────────────────────────────
 * Whole-layout actions
 * ──────────────────────────────────────────────── */

const templatesOpen = ref(false);

function templatePlaced() {
	editor.select(CANVAS_SELECTION);
	templatesOpen.value = false;
}

/* ────────────────────────────────────────────────
 * Keyboard
 * ──────────────────────────────────────────────── */

const SHORTCUTS = GRAPHICS_EDITOR_SHORTCUTS;

useGraphicsEditorKeyboard(editor, 'feature-match-overlay', {
	suspended: () => templatesOpen.value,
});
</script>

<template>
	<div class="space-y-4">
		<GraphicsAuthoringLeaseNotice
			:writable="writable"
			:lease-status="editLease.status.value"
			:can-take-over="editLease.canTakeOver.value"
			:holder-name="editLease.holderName.value"
			@take-over="editLease.takeOver"
		/>

		<section class="rounded-lg border border-default/70 bg-default p-3" data-testid="overlay-toolbar">
			<div class="flex flex-wrap items-end gap-3">
				<ScreenFeatureMatchSlotField
					:model-value="config.featureMatchId"
					:event-id="eventId"
					stacked
					size="sm"
					class="min-w-56 flex-1"
					@update:model-value="updateConfig({ featureMatchId: $event })"
				/>

				<div class="ml-auto flex items-center gap-1">
					<GraphicsSaveState
						class="mr-1"
						:save-state="saveState"
						:save-error="saveError"
						:writable="writable"
						@retry="retrySave()"
					/>
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
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
				/>
			</section>

			<section class="min-w-0 xl:sticky xl:top-4">
				<GraphicsPreviewThemePicker
					v-model="previewTheme.choice.value"
					class="mb-2"
					:items="previewTheme.items.value"
				/>
				<FeatureMatchOverlayPreviewOutputAside
					:preview-theme-values="previewTheme.previewThemeValues.value"
					:event-id="eventId"
					:screen="screen"
					:config="config"
					:selected-target="selectedTarget"
					:compositor-target="compositorTarget"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:publication-blocked="assetPublicationBlocked"
					:publication-block-reason="assetPublicationBlockReason"
					:selection-frame="selectionFrame"
					:selection-label="selectionLabel"
					:locked-boxes="editor.lockedSelectionBoxes.value"
					fit-height="calc(100vh - 14rem)"
					@select-target="selectHostTarget"
					@select-compositor-target="selectCompositorTarget"
					@manipulate="manipulate"
					@rotate="rotate"
					@gesture-start="editor.beginGesture"
					@gesture-end="editor.endGesture"
				/>
			</section>

			<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<GraphicsMultiLayerInspector
					v-if="severalSelected"
					:rects="selectedRects"
					:writable="canAuthor"
					:group-refusal="editor.groupRefusal.value"
					:can-align="editor.canAlign()"
					:can-distribute="editor.canDistribute()"
					@update="editor.setLayersGeometry"
					@group="editor.group()"
					@align="edge => editor.align(edge)"
					@distribute="axis => editor.distribute(axis)"
				/>
				<FeatureMatchOverlayCompositorInspector
					v-else-if="selection.type === 'item'"
					:layout="config.layout"
					:selected-target="compositorTarget"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:event-id="eventId"
					:theme-tokens="previewTheme.themeTokens.value"
					:writable="canAuthor"
					@update:composition="composition => updateFields({ layout: { ...config.layout, composition } })"
				/>
				<FeatureMatchOverlayLayerInspector
					v-else
					:selected-target="selectedTarget"
					:config="config"
					:update-config="updateFields"
					:screen-width="canvasWidth"
					:screen-height="canvasHeight"
					:screen="screen"
					:event-id="eventId"
					:writable="canAuthor"
				/>
			</section>
		</div>

		<!--
			The installation's reusable Feature Match Layouts. They act on the whole
			layout — saving copies this Screen's layout out, placing replaces it — so
			they open from the toolbar rather than from the layer list.

			Writable while this session holds the Graphics Authoring Lease; an observer
			still browses the library. Its place and save land this editor's unsaved
			edits first, and authoring is held while a placement is in flight.
		-->
		<USlideover v-model:open="templatesOpen" title="Layout templates">
			<template #body>
				<GraphicsFeatureMatchLayoutTemplateLibrary
					v-model:placing="placing"
					:event-id="eventId"
					:screen-id="screen.id"
					:writable="writable"
					:flush-edits="flush"
					:canvas-aspect-ratio="canvasWidth / canvasHeight"
					bare
					@placing="editor.checkpoint()"
					@placed="templatePlaced"
				/>
			</template>
		</USlideover>
	</div>
</template>
