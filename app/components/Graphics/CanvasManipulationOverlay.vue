<script setup lang="ts">
import type { GraphicRect } from '~~/shared/types/graphics';
import type { ManipulationHandle, SnapLines } from '~/modules/graphics/canvasManipulation';
import { useElementSize, useEventListener } from '@vueuse/core';
import { canvasSnapLines, manipulateRect, neighbourGaps, RESIZE_HANDLES } from '~/modules/graphics/canvasManipulation';
import { isSelectionToggle } from '~/modules/graphics/selection';

/**
 * Move and resize handles for the selected layer, drawn over an editor preview.
 *
 * It sits above the preview frame and takes no pointer events of its own, so
 * clicking anything else still reaches the frame and selects it; only the
 * selection box and its handles catch the pointer. Everything is measured in
 * canvas pixels and scaled to however large the preview is drawn.
 *
 * A drag snaps to the lines it is given, in the layer's container's pixels, and
 * draws the guide it landed on and the gap to the nearest neighbour on each axis.
 * Shift keeps the starting aspect ratio while resizing; Alt turns snapping off.
 *
 * With several layers selected (#740) the box is the one they cover: it moves
 * them together, outlines each, and offers no resize handle. While ⌘ or Ctrl is
 * held the box lets clicks through, so a ⌘-click on a layer under it reaches the
 * preview and adds that layer to the selection or takes it out.
 */
const props = defineProps<{
	/** The selected layer's stored rectangle, in its container's pixels; nothing shows without one. */
	rect: GraphicRect | null;
	/** Where the rectangle's container sits on the canvas. */
	origin?: { x: number; y: number };
	canvasWidth: number;
	canvasHeight: number;
	/** What the layer snaps to, in its container's pixels; the canvas's own lines without them. */
	snapLines?: SnapLines;
	label?: string;
	/** With several layers selected, each one's box, in canvas pixels; the selection then only moves. */
	members?: readonly GraphicRect[];
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

/** Whether ⌘ or Ctrl is held, so a click is a selection toggle for the preview beneath. */
const passesClicks = ref(false);
if (import.meta.client) {
	useEventListener(window, ['keydown', 'keyup'], (event: KeyboardEvent) => {
		passesClicks.value = isSelectionToggle(event);
	});
	useEventListener(window, 'blur', () => {
		passesClicks.value = false;
	});
}

const memberStyles = computed(() => scale.value === 0
	? []
	: (props.members ?? []).map(member => ({
			left: `${member.x * scale.value}px`,
			top: `${member.y * scale.value}px`,
			width: `${member.width * scale.value}px`,
			height: `${member.height * scale.value}px`,
		})));

const snapLines = computed<SnapLines>(() => {
	if (props.snapLines)
		return props.snapLines;
	const lines = canvasSnapLines({ width: props.canvasWidth, height: props.canvasHeight });
	return {
		x: lines.x.map(line => line - origin.value.x),
		y: lines.y.map(line => line - origin.value.y),
	};
});

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
	if (!props.rect || event.button !== 0 || isSelectionToggle(event))
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
	const result = manipulateRect(current.startRect, current.handle, delta, {
		keepRatio: event.shiftKey,
		snap: event.altKey
			? undefined
			: {
					lines: snapLines.value,
					threshold: 6 / scale.value,
				},
	});
	const rect = result.rect;
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

/** The guides and gaps a drag draws, in drawn pixels. */
const guides = computed(() => {
	const current = live.value;
	if (!current || scale.value === 0)
		return null;
	const { x, y } = origin.value;
	const gaps = neighbourGaps(current.rect, snapLines.value.neighbours ?? []);
	return {
		x: current.snapped.x === undefined
			? undefined
			: (current.snapped.x + x) * scale.value,
		y: current.snapped.y === undefined
			? undefined
			: (current.snapped.y + y) * scale.value,
		gaps: (['x', 'y'] as const).flatMap((axis) => {
			const gap = gaps[axis];
			if (!gap)
				return [];
			const [along, across, length] = axis === 'x'
				? ['left', 'top', 'width'] as const
				: ['top', 'left', 'height'] as const;
			const start = axis === 'x'
				? x
				: y;
			const cross = axis === 'x'
				? y
				: x;
			return [
				{
					axis,
					size: Math.round(gap.to - gap.from),
					style: {
						[along]: `${(gap.from + start) * scale.value}px`,
						[across]: `${(gap.at + cross) * scale.value}px`,
						[length]: `${(gap.to - gap.from) * scale.value}px`,
					},
				},
			];
		}),
	};
});

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
		<template v-if="guides">
			<div
				v-if="guides.x !== undefined"
				class="absolute inset-y-0 w-px bg-pink-500"
				:style="{ left: `${guides.x}px` }"
				data-testid="canvas-manipulation-guide"
				data-axis="x"
			/>
			<div
				v-if="guides.y !== undefined"
				class="absolute inset-x-0 h-px bg-pink-500"
				:style="{ top: `${guides.y}px` }"
				data-testid="canvas-manipulation-guide"
				data-axis="y"
			/>
			<div
				v-for="gap in guides.gaps"
				:key="gap.axis"
				class="absolute flex items-center justify-center bg-pink-500"
				:class="gap.axis === 'x' ? 'h-px' : 'w-px'"
				:style="gap.style"
				data-testid="canvas-manipulation-gap"
				:data-axis="gap.axis"
			>
				<span class="whitespace-nowrap rounded bg-pink-500 px-1 font-mono text-[0.6875rem] text-white">{{ gap.size }}</span>
			</div>
		</template>

		<template v-if="boxStyle && !live">
			<div
				v-for="(style, index) in memberStyles"
				:key="index"
				class="absolute outline-1 outline-primary/70 outline-dashed"
				:style="style"
				data-testid="canvas-manipulation-member"
			/>
		</template>
		<div
			v-if="boxStyle"
			class="absolute cursor-move outline-2 outline-primary"
			:class="passesClicks ? 'pointer-events-none' : 'pointer-events-auto'"
			:style="boxStyle"
			:aria-label="label ? `Move ${label}` : 'Move selection'"
			:data-passes-clicks="String(passesClicks)"
			data-testid="canvas-manipulation-box"
			@pointerdown="start($event, 'move')"
			@pointermove="moveTo"
			@pointerup="end"
			@pointercancel="end"
		>
			<span
				v-for="handle in members ? [] : RESIZE_HANDLES"
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
