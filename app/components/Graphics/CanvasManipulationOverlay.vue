<script setup lang="ts">
import type { GraphicRect } from '~~/shared/types/graphics';
import type { ManipulationHandle } from '~/modules/graphics/canvasManipulation';
import { useElementSize } from '@vueuse/core';
import { canvasSnapLines, manipulateRect, RESIZE_HANDLES } from '~/modules/graphics/canvasManipulation';

/**
 * Move and resize handles for the selected layer, drawn over an editor preview.
 *
 * It sits above the preview frame and takes no pointer events of its own, so
 * clicking anything else still reaches the frame and selects it; only the
 * selection box and its handles catch the pointer. Everything is measured in
 * canvas pixels and scaled to however large the preview is drawn.
 *
 * Shift keeps the starting aspect ratio while resizing; Alt turns snapping to the
 * canvas edges and centre lines off.
 */
const props = defineProps<{
	/** The selected layer's stored rectangle, in its container's pixels; nothing shows without one. */
	rect: GraphicRect | null;
	/** Where the rectangle's container sits on the canvas. */
	origin?: { x: number; y: number };
	canvasWidth: number;
	canvasHeight: number;
	label?: string;
}>();

const emit = defineEmits<{
	/** Each frame of a gesture; `gesture` is the same for every frame of one drag. */
	change: [rect: GraphicRect, gesture: number];
}>();

const root = ref<HTMLElement | null>(null);
const { width: drawnWidth } = useElementSize(root);
const scale = computed(() => props.canvasWidth > 0
	? drawnWidth.value / props.canvasWidth
	: 0);

const origin = computed(() => props.origin ?? { x: 0, y: 0 });

interface Drag {
	handle: ManipulationHandle;
	pointerId: number;
	startX: number;
	startY: number;
	startRect: GraphicRect;
	gesture: number;
}

let gestureCount = 0;
const drag = shallowRef<Drag | null>(null);
/** What the gesture is drawing, ahead of the round trip through the stored layout. */
const live = shallowRef<{ rect: GraphicRect; snapped: { x?: number; y?: number } } | null>(null);

const shownRect = computed(() => live.value?.rect ?? props.rect);

function toCanvas(rect: GraphicRect): GraphicRect {
	return { ...rect, x: rect.x + origin.value.x, y: rect.y + origin.value.y };
}

const boxStyle = computed(() => {
	const rect = shownRect.value;
	if (!rect || scale.value === 0)
		return null;
	const canvasRect = toCanvas(rect);
	return {
		left: `${canvasRect.x * scale.value}px`,
		top: `${canvasRect.y * scale.value}px`,
		width: `${canvasRect.width * scale.value}px`,
		height: `${canvasRect.height * scale.value}px`,
	};
});

const HANDLE_POSITION: Record<(typeof RESIZE_HANDLES)[number], string> = {
	nw: 'left-0 top-0 cursor-nwse-resize',
	n: 'left-1/2 top-0 cursor-ns-resize',
	ne: 'left-full top-0 cursor-nesw-resize',
	e: 'left-full top-1/2 cursor-ew-resize',
	se: 'left-full top-full cursor-nwse-resize',
	s: 'left-1/2 top-full cursor-ns-resize',
	sw: 'left-0 top-full cursor-nesw-resize',
	w: 'left-0 top-1/2 cursor-ew-resize',
};

function start(event: PointerEvent, handle: ManipulationHandle) {
	if (!props.rect || event.button !== 0)
		return;
	event.preventDefault();
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	gestureCount += 1;
	drag.value = {
		handle,
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		startRect: { ...props.rect },
		gesture: gestureCount,
	};
}

function moveTo(event: PointerEvent) {
	const current = drag.value;
	if (!current || event.pointerId !== current.pointerId || scale.value === 0)
		return;
	const delta = {
		x: (event.clientX - current.startX) / scale.value,
		y: (event.clientY - current.startY) / scale.value,
	};
	const result = manipulateRect(toCanvas(current.startRect), current.handle, delta, {
		keepRatio: event.shiftKey,
		snap: event.altKey
			? undefined
			: {
					lines: canvasSnapLines({ width: props.canvasWidth, height: props.canvasHeight }),
					threshold: 6 / scale.value,
				},
	});
	const rect = { ...result.rect, x: result.rect.x - origin.value.x, y: result.rect.y - origin.value.y };
	const previous = live.value?.rect ?? current.startRect;
	live.value = { rect, snapped: result.snapped };
	if (rect.x !== previous.x || rect.y !== previous.y || rect.width !== previous.width || rect.height !== previous.height)
		emit('change', rect, current.gesture);
}

function end(event: PointerEvent) {
	if (drag.value?.pointerId !== event.pointerId)
		return;
	drag.value = null;
	live.value = null;
}

const readout = computed(() => {
	const rect = live.value?.rect;
	if (!rect)
		return null;
	return drag.value?.handle === 'move'
		? `${rect.x}, ${rect.y}`
		: `${rect.width} × ${rect.height}`;
});
</script>

<template>
	<div ref="root" class="pointer-events-none absolute inset-0 overflow-hidden" data-testid="canvas-manipulation-overlay">
		<template v-if="live && scale > 0">
			<div
				v-if="live.snapped.x !== undefined"
				class="absolute inset-y-0 w-px bg-pink-500"
				:style="{ left: `${live.snapped.x * scale}px` }"
			/>
			<div
				v-if="live.snapped.y !== undefined"
				class="absolute inset-x-0 h-px bg-pink-500"
				:style="{ top: `${live.snapped.y * scale}px` }"
			/>
		</template>

		<div
			v-if="boxStyle"
			class="pointer-events-auto absolute cursor-move outline-2 outline-primary"
			:style="boxStyle"
			:aria-label="label ? `Move ${label}` : 'Move selection'"
			data-testid="canvas-manipulation-box"
			@pointerdown="start($event, 'move')"
			@pointermove="moveTo"
			@pointerup="end"
			@pointercancel="end"
		>
			<span
				v-for="handle in RESIZE_HANDLES"
				:key="handle"
				class="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-primary bg-white"
				:class="HANDLE_POSITION[handle]"
				:data-handle="handle"
				@pointerdown.stop="start($event, handle)"
				@pointermove="moveTo"
				@pointerup="end"
				@pointercancel="end"
			/>
			<span
				v-if="readout"
				class="absolute left-0 top-full mt-1 whitespace-nowrap rounded bg-inverted px-1.5 py-0.5 font-mono text-[0.6875rem] text-inverted"
			>{{ readout }}</span>
		</div>
	</div>
</template>
