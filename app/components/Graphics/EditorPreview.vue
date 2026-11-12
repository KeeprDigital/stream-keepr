<script setup lang="ts">
import type { GraphicAnimationPhase, GraphicRect } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { ScreenOutputPathOptions } from '~~/shared/utils/screenOutput';
import type { EditorSelectionFrame } from '~/modules/graphics/editor/layerFrame';
import type { ExpectedSender, GraphicsPreviewAnimationPlan, GraphicsPreviewPush, MessageEnvelope } from '~/modules/graphics/previewMessages';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { screenOutputPath } from '~~/shared/utils/screenOutput';
import { isGraphicsPreviewReadyMessage, isGraphicsPreviewSelectMessage } from '~/modules/graphics/previewMessages';

/**
 * The one preview shell both graphics editors mount (#1101): the shared preview
 * panel (output selection, zoom and pan, item and advisory safe-area guides),
 * the real Screen Output frame inside it, everything said to and heard from that
 * frame, the canvas handles over it, and the Graphic Animation Preview control.
 *
 * A host supplies what differs: the messages its frame reads (`messages`), any
 * report its frame makes in the host's own vocabulary (`receive`), the run its
 * animation control plays, the selection its handles move, and its own toolbar
 * controls (`controls` slot) and extras above the viewport (default slot).
 *
 * ## Talking to the frame
 *
 * Every message goes to the frame on `load`, and again when the frame announces
 * it is listening, because the `load` push races the frame's own app mounting and
 * a push that lost was dropped in silence (#234, #235). Between those, a message
 * is pushed only when it changed, compared by type.
 *
 * A report is heard only from this shell's own frame, at this origin, through the
 * shared sender check (#252, #259, #260); a frame that is gone hears nothing.
 * After any report the frame gives up keyboard focus, since a click in it focuses
 * its own document, whose key presses never reach the editor's shortcuts.
 *
 * Guides and the host's URL options ride the preview's own URL, which a live
 * Screen Output never carries, so nothing drawn here can reach one.
 */
const props = withDefaults(defineProps<{
	eventId: number;
	screenSlug: string;
	canvasWidth: number;
	canvasHeight: number;
	/** The frame's accessible name. */
	title: string;
	/** What the frame is told, one message per type, each a plain cloneable object. */
	messages: readonly GraphicsPreviewPush[];
	/** What else the host asks of its preview's URL. */
	urlOptions?: Pick<ScreenOutputPathOptions, 'stressDataset'>;
	/**
	 * A report from the frame in the host's own vocabulary, checked with the
	 * host's guard against this frame as the expected sender. True when it was
	 * one, so the frame gives focus back as it does for a selection.
	 */
	receive?: (message: MessageEnvelope, expected: ExpectedSender) => boolean;
	/** What an animation run plays, or null when nothing playable is selected. */
	animationTarget: Pick<GraphicsPreviewAnimationPlan, 'graphicId' | 'itemId'> | null;
	/** Why Play is unavailable while there is no target. */
	animationHint: string;
	/** The host's lifecycle phases; every phase when absent. */
	animationPhases?: readonly GraphicAnimationPhase[];
	/** Where the selected layers sit on the canvas, when this session may move them. */
	selectionFrame?: EditorSelectionFrame | null;
	selectionLabel?: string;
	/** Where each selected locked layer sits on the canvas, badged as locked. */
	lockedBoxes?: readonly GraphicRect[];
	/** A solid colour behind the frame; omitted, it shows transparency. */
	background?: string;
	/** The tallest the fitted preview is drawn, as a CSS length. */
	fitHeight?: string;
	collapsible?: boolean;
}>(), {
	collapsible: true,
});

const emit = defineEmits<{
	/** `toggle` is a ⌘- or Ctrl-click: add the layer to the selection, or take it out (#740). */
	select: [target: GraphicsSelectionTarget, toggle: boolean];
	/** The selection moved or resized on the canvas; one `gesture` per drag. */
	manipulate: [rect: GraphicRect, gesture: number];
	/** Each frame of a canvas rotate drag, as the selected Graphic Item's new Graphic Rotation. */
	rotate: [rotation: number, gesture: number];
	/** A canvas drag began, and ended: the frames between are one edit. */
	gestureStart: [];
	gestureEnd: [];
}>();

/** The run the animation control describes; null composes at the Graphic Resting State. */
const animationPlan = defineModel<GraphicsPreviewAnimationPlan | null>('animationPlan', { default: null });

const output = ref<ScreenOutput>('overlay');
const itemGuides = ref(true);
const safeAreaGuides = ref(false);
const frame = ref<HTMLIFrameElement | null>(null);

const url = computed(() => screenOutputPath({
	eventId: props.eventId,
	screenSlug: props.screenSlug,
	output: output.value,
	embed: 'preview',
	itemGuides: itemGuides.value,
	safeAreaGuides: safeAreaGuides.value,
	...props.urlOptions,
}));

/** What the frame was last told, per message type, as sent. */
const told = new Map<string, string>();

function post(message: GraphicsPreviewPush, onlyIfChanged: boolean) {
	const target = frame.value?.contentWindow;
	if (!import.meta.client || !target)
		return;
	const sent = JSON.stringify(message);
	if (onlyIfChanged && told.get(message.type) === sent)
		return;
	told.set(message.type, sent);
	target.postMessage(JSON.parse(sent), window.location.origin);
}

function pushAll() {
	for (const message of props.messages)
		post(message, false);
}

watch(() => props.messages, (messages) => {
	for (const message of messages)
		post(message, true);
}, { deep: true });

// Each switch changes the URL, which reloads the frame; its `load` and its ready
// both push again, and so does this, once the new frame exists.
watch(url, () => {
	told.clear();
	void nextTick(pushAll);
});

function releaseFrameFocus() {
	if (import.meta.client && frame.value && document.activeElement === frame.value)
		frame.value.blur();
}

function hear(message: MessageEvent) {
	const expected = {
		origin: window.location.origin,
		source: frame.value?.contentWindow ?? null,
	};

	if (isGraphicsPreviewReadyMessage(message, expected)) {
		pushAll();
		return;
	}

	if (isGraphicsPreviewSelectMessage(message, expected)) {
		releaseFrameFocus();
		emit('select', message.data.target, message.data.toggle === true);
		return;
	}

	if (props.receive?.(message, expected))
		releaseFrameFocus();
}

onMounted(() => window.addEventListener('message', hear));
onBeforeUnmount(() => window.removeEventListener('message', hear));
</script>

<template>
	<GraphicsPreviewPanel
		v-model:output="output"
		v-model:item-guides="itemGuides"
		v-model:safe-area-guides="safeAreaGuides"
		:canvas-width="canvasWidth"
		:canvas-height="canvasHeight"
		:background="background"
		:fit-height="fitHeight"
		:collapsible="collapsible"
		:animation-playing="animationPlan !== null"
	>
		<template v-if="$slots.controls" #controls>
			<slot name="controls" />
		</template>

		<template #animation>
			<GraphicsAnimationPreviewControls
				:target="animationTarget"
				:phases="animationPhases"
				:hint="animationHint"
				@update:plan="plan => { animationPlan = plan }"
			>
				<slot name="animation" />
			</GraphicsAnimationPreviewControls>
		</template>

		<slot />

		<template #viewport>
			<iframe
				ref="frame"
				:key="url"
				:src="url"
				class="absolute inset-0 size-full border-0"
				:title="title"
				@load="pushAll"
			/>
			<GraphicsCanvasManipulationOverlay
				:rect="selectionFrame?.rect ?? null"
				:origin="selectionFrame?.origin"
				:snap-lines="selectionFrame?.snapLines"
				:members="selectionFrame?.members"
				:rotation="selectionFrame?.rotation"
				:anchor="selectionFrame?.anchor"
				:canvas-width="canvasWidth"
				:canvas-height="canvasHeight"
				:label="selectionLabel"
				:locked="lockedBoxes"
				@change="(rect, gesture) => emit('manipulate', rect, gesture)"
				@rotate="(rotation, gesture) => emit('rotate', rotation, gesture)"
				@gesture-start="emit('gestureStart')"
				@gesture-end="emit('gestureEnd')"
			/>
		</template>
	</GraphicsPreviewPanel>
</template>
