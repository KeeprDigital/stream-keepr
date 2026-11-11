<script setup lang="ts">
import type { BroadcastGraphicsBackgroundConfig } from '~~/shared/animationEffects';
import type { BroadcastGraphicConfig, GraphicChannelConfig, GraphicRect } from '~~/shared/types/graphics';
import type { GraphicsAuthoringLeaseStatus } from '~/composables/screen/useGraphicsAuthoringLease';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { BROADCAST_GRAPHICS_HOST_CONTRACT } from '~~/shared/modules/graphics';
import GraphicsCompositorInspector from '~/components/Graphics/Compositor/Inspector.vue';
import GraphicsCompositorPreview from '~/components/Graphics/Compositor/Preview.vue';
import { useGraphicsEditor } from '~/composables/useGraphicsEditor';
import { useGraphicsEditorKeyboard } from '~/composables/useGraphicsEditorKeyboard';
import { broadcastGraphicsEditorHost } from '~/modules/broadcast-graphics/editorHost';
import { CANVAS_SELECTION, layerConfig } from '~/modules/graphics/editor/host';
import { NUMBER_SCRUB_GESTURE } from '~/modules/graphics/numberScrubGesture';
import { graphicsSelectionKey } from '~/modules/graphics/selection';
import BroadcastGraphicsLayerList from './LayerList.vue';

/**
 * The Edit workspace of a Broadcast Graphics Screen: the shared graphics editor
 * (#1100) — its layer list, undo, several selected, locks, grouping, alignment,
 * clipboard and keyboard — with the compositor's preview, its canvas handles
 * (#1101), and the inspector, over the Screen's authored stack.
 *
 * The whole workspace is the artifact one Graphics Authoring Lease covers, so
 * exactly one session authors it and every other session observes it. An observer
 * gets the same workspace read-only — the same stack, the same preview, the same
 * properties — because watching a colleague compose is the point, and it takes the
 * lease over when it needs to author instead.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	/** The Screen's Graphic Channels: its optional playout lanes. */
	channels: readonly GraphicChannelConfig[];
	/** The Screen's Broadcast Graphics Background, or none authored. */
	background?: BroadcastGraphicsBackgroundConfig;
	selectedTarget: GraphicsSelectionTarget;
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
	/** Whether this session currently holds the workspace's Graphics Authoring Lease. */
	writable?: boolean;
	leaseStatus?: GraphicsAuthoringLeaseStatus;
	canTakeOver?: boolean;
	/** Who holds it, where the server could resolve their session to a person. */
	holderName?: string | null;
	/**
	 * Whether the realtime connection feeding the Broadcast Graphics Live Session
	 * is currently down, from the sync the settings surface holds. While it is,
	 * this client cannot know what is on air, and the on-air marks below say so
	 * instead of claiming anything.
	 */
	playoutDisconnected?: boolean;
	/**
	 * The authored save's answer, from the mode-config write this workspace's
	 * edits funnel into (#381). `committed` is an affirmative fact rather than
	 * the absence of `saving`: a save can run for seconds against deployed
	 * remote D1 (#374), and an author who looked away needs the difference
	 * between "it landed" and "the failure toast was missed" said out loud.
	 */
	saveState?: 'idle' | 'saving' | 'committed' | 'failed';
	/**
	 * The sentence the authority wrote about a failed save — a CAS refusal names
	 * the slot to repair — shown verbatim in place of generic wording.
	 */
	saveError?: string | null;
	/**
	 * Lands every unsaved edit of this workspace and answers whether none is left,
	 * for the Template library: a placement rewrites the stored stack and a save
	 * reads it, so neither may run ahead of an edit still on its way.
	 */
	flushEdits?: () => Promise<boolean>;
}>();

const emit = defineEmits<{
	'update:graphics': [graphics: BroadcastGraphicConfig[]];
	/**
	 * Declaring, renaming, repolicying, or deleting a Graphic Channel, together with
	 * any membership the change releases or assigns — one write, because deleting a
	 * lane and releasing its members must never be two.
	 */
	'update:channels': [next: { channels?: GraphicChannelConfig[]; graphics?: BroadcastGraphicConfig[] }];
	/** The Screen's one background: its effect, its params, and whether it shows. */
	'update:background': [background: BroadcastGraphicsBackgroundConfig];
	'update:selectedTarget': [target: GraphicsSelectionTarget];
	'takeOver': [];
	/** Re-send the failed save's still-held updates. */
	'retrySave': [];
}>();

/**
 * The Broadcast Graphic an author can save as a Broadcast Graphic Template.
 *
 * Saving copies one finished design, not the Screen's whole stack, so the library
 * offers exactly the graphic the author is looking at.
 */
const selectedGraphic = computed(() =>
	props.graphics.find(graphic => graphic.id === props.selectedGraphicId) ?? null,
);

/**
 * The game of the Event this Screen belongs to.
 *
 * The inspector needs it to author Graphic Input Bindings: the field catalog
 * separates stable common fields from ones specific to the current Event's game, and
 * an author must never be offered a field this Event cannot resolve.
 */
const eventStore = useEventStore();
const game = computed(() => eventStore.event?.game);

/**
 * The Theme the workspace previews under (#829): this Screen's Event's, unless
 * the author picks another to see the design under a different Theme.
 */
const previewTheme = useGraphicsPreviewTheme(() => eventStore.event?.themeId);

/**
 * The Broadcast Graphics currently composing into a program output (#373).
 *
 * Read from the same Broadcast Graphics Live Session store the hoisted Program
 * monitor projects from — one authority, so the mark in the tree can never
 * disagree with the monitor beside it — at this surface's own playout clock
 * instant. The set covers entering, on-air, updating, and exiting, because a
 * graphic composes into the frame in all four, and that is exactly when an
 * Edit-workspace change under a live On-air Update Policy can reach program.
 * `waiting` is deliberately outside it: a waiting graphic is on no output yet.
 */
const sessionStore = useBroadcastGraphicsLiveSessionStore();
const playoutNow = useBroadcastGraphicsPlayoutClock(
	() => props.screen.id,
	() => props.graphics,
	() => props.channels,
);
const onAirGraphicIds = computed(() => new Set(sessionStore.onAirGraphicIds(
	props.screen.id,
	props.graphics,
	playoutNow.value,
	props.channels,
)));

/** A placement is a new Broadcast Graphic, and the author is put straight on it. */
function selectPlacedGraphic(graphicId: string) {
	emit('update:selectedTarget', { type: 'graphic', graphicId });
}

/**
 * Fail closed: until a caller says this session holds the lease, the workspace is
 * an observer's. An unstated permission must never read as one that was granted.
 */
const holdsLease = computed(() => props.writable === true);

/**
 * A Template placement is in flight. The server is rewriting the stack and the
 * Screen is then reloaded, so an edit made meanwhile would be built on the stack
 * from before the placement and would write the placed Broadcast Graphic away.
 */
const placing = ref(false);

/** Whether this session may edit now: it holds the lease, and no placement is in flight. */
const canAuthor = computed(() => holdsLease.value && !placing.value);

/**
 * Whether a Broadcast Graphic may be on a program output now. While the realtime
 * connection is down this client cannot know, so every graphic may be: an edit
 * the editor refuses is better than one that reaches program unseen.
 */
function mayBeOnAir(graphicId: string): boolean {
	return props.playoutDisconnected === true || onAirGraphicIds.value.has(graphicId);
}

/*
 * The shared graphics editor over the stack. Every write — the layer list, the
 * canvas, the keyboard and the inspector — is one of its undo steps, made only
 * while this session holds the lease, no placement is in flight, and the graphic
 * it changes is not on air (#1100). Undo covers the stack, not the Graphic
 * Channels or the Background beside it.
 */
const host = broadcastGraphicsEditorHost({
	graphics: () => props.graphics,
	channels: () => props.channels,
	write: graphics => emit('update:graphics', graphics),
	selectedGraphicId: () => props.selectedGraphicId,
	canvasWidth: () => props.canvasWidth,
	canvasHeight: () => props.canvasHeight,
	writable: holdsLease,
	held: placing,
	onAir: mayBeOnAir,
});
const editor = useGraphicsEditor(host);
const { layers } = editor;
const severalSelected = computed(() => layers.value.length > 1);

useGraphicsEditorKeyboard(editor, 'broadcast-graphics');

/** A drag on a property panel's number label undoes as one step, however long it pauses. */
provide(NUMBER_SCRUB_GESTURE, {
	begin: editor.beginGesture,
	end: editor.endGesture,
});

/** A placement undoes as one step: the stack from before it is recorded as it starts. */
watch(placing, (isPlacing) => {
	if (isPlacing)
		editor.checkpoint();
});

/*
 * The editor holds the selected layers; the Settings surface holds the selected
 * target, which the Live workspace and the `?graphic=` address share. One layer
 * is that target, several are their Broadcast Graphic, and a Broadcast Graphic
 * or the canvas selected from elsewhere selects no layer.
 */
function editorTarget(): GraphicsSelectionTarget | null {
	const selected = layers.value;
	if (selected.length === 1)
		return { type: 'item', graphicId: selected[0]!.graphicId, itemId: selected[0]!.itemId };
	const anchor = editor.anchor.value;
	if (selected.length > 1 && anchor)
		return { type: 'graphic', graphicId: anchor.graphicId };
	// No layer left: a removed item gives way to its graphic, as long as it stands.
	const stale = props.selectedTarget;
	if (stale.type !== 'item')
		return null;
	return props.graphics.some(graphic => graphic.id === stale.graphicId)
		? { type: 'graphic', graphicId: stale.graphicId }
		: { type: 'canvas' };
}

watch(layers, () => {
	const target = editorTarget();
	if (target && graphicsSelectionKey(target) !== graphicsSelectionKey(props.selectedTarget))
		emit('update:selectedTarget', target);
}, { flush: 'sync' });

watch(() => props.selectedTarget, (target) => {
	const selected = layers.value;
	if (target.type === 'item') {
		const one = selected.length === 1
			&& selected[0]!.graphicId === target.graphicId
			&& selected[0]!.itemId === target.itemId;
		if (!one)
			editor.select({ type: 'item', graphicId: target.graphicId, itemId: target.itemId });
		return;
	}
	const keep = target.type === 'graphic'
		&& selected.length > 1
		&& selected.every(layer => layer.graphicId === target.graphicId);
	if (selected.length > 0 && !keep)
		editor.select(CANVAS_SELECTION);
}, { immediate: true });

/** A Broadcast Graphic selected from its row, or none with the canvas. */
function selectGraphic(graphicId: string | null) {
	emit('update:selectedTarget', graphicId
		? { type: 'graphic', graphicId }
		: { type: 'canvas' });
}

/** A click in the preview selects what it hits alone; a ⌘- or Ctrl-click adds an item or takes it out. */
function selectInPreview(target: GraphicsSelectionTarget, toggle = false) {
	if (target.type === 'item') {
		const layer = { type: 'item', graphicId: target.graphicId, itemId: target.itemId } as const;
		if (toggle)
			editor.toggleSelect(layer);
		else
			editor.select(layer);
		return;
	}
	editor.select(CANVAS_SELECTION);
	emit('update:selectedTarget', target);
}

/** Each selected layer's stored rectangle, for the panel that edits several. */
const selectedRects = computed(() => layers.value.flatMap((layer) => {
	const rect = layerConfig(host.tree, props.graphics, layer);
	return rect
		? [rect]
		: [];
}));

/** Whether the Broadcast Graphic the inspector shows may be on air, and so is not edited. */
const selectedOnAir = computed(() => selectedGraphic.value !== null && !editor.mayEditComposition(selectedGraphic.value));

/**
 * Where the preview's canvas handles go (#1101), with the lines they snap to:
 * none while this session may not move the selection, so neither handles nor
 * snap guides show to an observer, during a placement, or over a graphic that
 * may be on air.
 */
const selectionFrame = computed(() => canAuthor.value && !selectedOnAir.value
	? editor.selectionFrame.value
	: null);
const selectionLabel = computed(() => severalSelected.value
	? `${layers.value.length} layers`
	: layers.value[0] && layerConfig(host.tree, props.graphics, layers.value[0])?.label);

// A canvas drag is bracketed as one gesture, so it undoes as one step however
// long it pauses; the key coalesces frames arriving outside one.
function manipulate(rect: GraphicRect, gesture: number) {
	editor.setSelectionRect(rect, { coalesce: `canvas:${gesture}` });
}

function rotate(rotation: number, gesture: number) {
	editor.setRotation(editor.selection.value, rotation, { coalesce: `canvas:${gesture}` });
}
</script>

<template>
	<div>
		<GraphicsAuthoringLeaseNotice
			class="mb-4"
			:writable="holdsLease"
			:lease-status="leaseStatus"
			:can-take-over="canTakeOver"
			:holder-name="holderName"
			@take-over="emit('takeOver')"
		/>

		<div class="mb-2 flex flex-wrap items-center justify-end gap-2">
			<GraphicsSaveState
				:save-state="saveState ?? 'idle'"
				:save-error="saveError"
				:writable="holdsLease"
				@retry="emit('retrySave')"
			/>
			<UFieldGroup size="sm">
				<UButton
					variant="soft"
					color="neutral"
					icon="i-lucide-undo-2"
					:disabled="!editor.canUndo.value"
					aria-label="Undo"
					title="Undo (⌘Z)"
					data-testid="editor-undo"
					@click="editor.undo()"
				/>
				<UButton
					variant="soft"
					color="neutral"
					icon="i-lucide-redo-2"
					:disabled="!editor.canRedo.value"
					aria-label="Redo"
					title="Redo (⌘⇧Z)"
					data-testid="editor-redo"
					@click="editor.redo()"
				/>
			</UFieldGroup>
		</div>

		<div class="grid min-h-[calc(100vh-18rem)] items-start gap-4 xl:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(19rem,24rem)] 2xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(24rem,30rem)]">
			<section class="min-w-0 rounded-lg border border-default/70 bg-default p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
				<BroadcastGraphicsLayerList
					:graphics="graphics"
					:editor="editor"
					:tree="host.tree"
					:selected-graphic-id="selectedTarget.type === 'graphic' ? selectedTarget.graphicId : null"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					@select-graphic="selectGraphic"
				>
					<template #graphic-badge="{ graphic }">
						<!--
							Reconnect Resync's rule, applied to a badge: while the
							connection is down this client cannot know what is on air,
							so every graphic says so — a frozen or absent mark would
							read as "not on air" on exactly the surface guarding live
							edits.
						-->
						<UBadge
							v-if="playoutDisconnected"
							data-testid="graphic-playout-unknown"
							color="neutral"
							variant="outline"
							size="sm"
							icon="i-lucide-wifi-off"
							title="Disconnected: whether this graphic is on air cannot be known until the connection returns."
						>
							Playout unknown
						</UBadge>
						<UBadge
							v-else-if="onAirGraphicIds.has(graphic.id)"
							data-testid="graphic-on-air"
							color="error"
							variant="subtle"
							size="sm"
							icon="i-lucide-radio"
							title="This Broadcast Graphic is composing into a program output. It cannot be edited until it is off air."
						>
							On air
						</UBadge>
					</template>
				</BroadcastGraphicsLayerList>

				<!--
					Beside the stack, each a section that starts closed and says what it
					holds in one line, so the stack is what an author sees.
				-->
				<div class="mt-4 border-t border-default/70">
					<!--
						Graphic Channels sit beside the stack rather than in it: a lane decides
						which graphics replace each other on air, and never what composites over
						what.
					-->
					<ScreenModesBroadcastGraphicsChannels
						:graphics="graphics"
						:channels="channels"
						:writable="canAuthor"
						@update:channels="emit('update:channels', $event)"
					/>

					<!--
						The background sits beside the stack for the same reason the channels do:
						it is a Screen-level decision about the show, and changes nothing about
						any design or about Graphic Layer Order.
					-->
					<ScreenModesBroadcastGraphicsBackground
						:background="background"
						:writable="canAuthor"
						@update:background="emit('update:background', $event)"
					/>

					<!--
						The Broadcast Graphic Template library lives in the Edit workspace and
						nowhere else: saving and placing designs is authoring, and the Live
						workspace deliberately has no route to either.
					-->
					<GraphicsBroadcastGraphicTemplateLibrary
						v-model:placing="placing"
						:event-id="eventId"
						:screen-id="screen.id"
						:selected-graphic="selectedGraphic"
						:writable="holdsLease"
						:flush-edits="flushEdits"
						@placed="selectPlacedGraphic"
					/>
				</div>
			</section>

			<section class="min-w-0 xl:sticky xl:top-4">
				<GraphicsPreviewThemePicker
					v-model="previewTheme.choice.value"
					class="mb-2"
					:items="previewTheme.items.value"
				/>
				<GraphicsCompositorPreview
					:event-id="eventId"
					:screen="screen"
					:graphics="graphics"
					:selected-target="selectedTarget"
					:canvas-width="canvasWidth"
					:canvas-height="canvasHeight"
					:preview-theme-values="previewTheme.previewThemeValues.value"
					:selection-frame="selectionFrame"
					:selection-label="selectionLabel"
					:locked-boxes="editor.lockedSelectionBoxes.value"
					@select-target="selectInPreview"
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
					:writable="editor.writable.value && !selectedOnAir"
					:group-refusal="editor.groupRefusal.value"
					:can-align="editor.canAlign()"
					:can-distribute="editor.canDistribute()"
					@update="editor.setLayersGeometry"
					@group="editor.group()"
					@align="edge => editor.align(edge)"
					@distribute="axis => editor.distribute(axis)"
				/>
				<template v-else>
					<UAlert
						v-if="selectedOnAir"
						class="mb-3"
						color="warning"
						variant="soft"
						icon="i-lucide-radio"
						:title="playoutDisconnected ? 'Playout unknown' : 'On air'"
						:description="playoutDisconnected
							? 'Whether this Broadcast Graphic is on air cannot be known until the connection returns, so it cannot be edited until then.'
							: 'This Broadcast Graphic is composing into a program output, so it cannot be edited until it is off air.'"
						data-testid="edit-on-air-notice"
					/>
					<GraphicsCompositorInspector
						:graphics="graphics"
						:selected-target="selectedTarget"
						:contract="BROADCAST_GRAPHICS_HOST_CONTRACT"
						:canvas-width="canvasWidth"
						:canvas-height="canvasHeight"
						:event-id="eventId"
						:game="game"
						:writable="canAuthor && !selectedOnAir"
						:theme-tokens="previewTheme.themeTokens.value"
						@update:graphics="editor.editFields($event)"
					/>
				</template>
			</section>
		</div>
	</div>
</template>
