<script setup lang="ts">
import type { GraphicsItemGuide, GraphicsSafeAreaGuide } from '~/modules/graphics/renderModel';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';

/**
 * The editor preview's guide layer: the canvas catch-all, the advisory
 * action-safe and title-safe guides, and one clickable guide per Graphic Item.
 *
 * Advisory only. It sits above the composed frame, never clips or constrains an
 * authored Graphic Item, and is drawn only from guides the render model carries —
 * which only an editor preview ever asks for, so no guide can reach a live Screen
 * Output.
 *
 * ## Why this is a component rather than markup inside the canvas
 *
 * There is exactly one guide layer over one canvas, and the host that paints the
 * canvas is the one that draws it. A Broadcast Graphics Screen paints its own
 * canvas, so its compositor canvas draws this. A Feature Match Overlay paints the
 * canvas itself and mounts the composition as one layer inside it, so *it* draws
 * this and passes its own host-owned guides — the Frame's Source Items and the
 * legacy widgets — through the slot.
 *
 * Two stacked guide layers would not work: each covers the whole canvas, so
 * whichever landed underneath would be unclickable, and each would contribute a
 * second canvas catch-all swallowing the other's guides.
 *
 * Ordering inside the layer is document order, and it is load-bearing: the canvas
 * catch-all is first so every guide sits above it, and slotted host guides come
 * last so a host-owned item stays selectable where it overlaps a shared one.
 */
const props = defineProps<{
	itemGuides: readonly GraphicsItemGuide[];
	safeAreaGuides: readonly GraphicsSafeAreaGuide[];
	/**
	 * Whether clicking empty canvas selects the canvas. Off while only advisory
	 * safe-area guides are shown, because there is then no selection to make.
	 */
	selectableCanvas?: boolean;
}>();

const emit = defineEmits<{ select: [target: GraphicsSelectionTarget] }>();

function selectItem(guide: GraphicsItemGuide) {
	emit('select', { type: 'item', graphicId: guide.graphicId, itemId: guide.itemId });
}

const hasGuideLayer = computed(() =>
	props.selectableCanvas === true || props.itemGuides.length > 0 || props.safeAreaGuides.length > 0,
);
</script>

<template>
	<div v-if="hasGuideLayer" class="guide-layer" aria-label="Graphics compositor guide layer">
		<button
			v-if="selectableCanvas"
			type="button"
			class="canvas-guide"
			aria-label="Select canvas"
			@click.stop="emit('select', { type: 'canvas' })"
		/>
		<div
			v-for="guide in safeAreaGuides"
			:key="guide.id"
			class="safe-area-guide"
			:class="`safe-area-guide--${guide.id}`"
			:data-safe-area-guide="guide.id"
			:style="guide.style"
			aria-hidden="true"
		>
			<span>{{ guide.label }}</span>
		</div>
		<div
			v-for="guide in itemGuides"
			:key="`${guide.graphicId}:${guide.itemId}`"
			class="item-guide"
			:class="{ 'is-selected': guide.selected, 'is-in-selected-graphic': guide.inSelectedGraphic }"
			:data-in-selected-graphic="String(guide.inSelectedGraphic)"
			:data-item-guide="guide.itemId"
			:style="guide.style"
			role="button"
			tabindex="0"
			:aria-label="`Select ${guide.label}`"
			@click.stop="selectItem(guide)"
			@keydown.enter.stop="selectItem(guide)"
			@keydown.space.prevent.stop="selectItem(guide)"
		>
			<span>{{ guide.label }}</span>
		</div>
		<slot />
	</div>
</template>

<style scoped>
.guide-layer {
	position: absolute;
	inset: 0;
	z-index: 999;
}

.canvas-guide {
	position: absolute;
	inset: 0;
	border: 0;
	background: transparent;
	cursor: default;
}

/*
 * Advisory only: the guide layer sits above the composed frame and never
 * clips or constrains an authored Graphic Item.
 */
.safe-area-guide {
	position: absolute;
	box-sizing: border-box;
	pointer-events: none;
	border: 1px dashed rgba(255, 255, 255, 0.75);
}

.safe-area-guide--title-safe {
	border-color: rgba(250, 204, 21, 0.85);
}

.safe-area-guide span {
	position: absolute;
	right: 0;
	bottom: 0;
	padding: 2px 6px;
	background: rgba(0, 0, 0, 0.7);
	color: #fff;
	font-size: 12px;
	line-height: 1.2;
}

/*
 * Every composed Broadcast Graphic gets item guides, so the authored stack order
 * is visible while authoring. The graphic under authoring is drawn brighter so it
 * stands out from its neighbours without hiding them.
 */
.item-guide {
	position: absolute;
	box-sizing: border-box;
	border: 2px dashed rgba(56, 189, 248, 0.35);
	background: rgba(0, 119, 163, 0.04);
	cursor: pointer;
}

.item-guide.is-in-selected-graphic {
	border-color: rgba(56, 189, 248, 0.95);
	background: rgba(0, 119, 163, 0.08);
}

.item-guide span {
	position: absolute;
	left: 0;
	top: 0;
	max-width: 100%;
	padding: 2px 6px;
	background: rgba(0, 0, 0, 0.75);
	color: #fff;
	font-size: 12px;
	line-height: 1.2;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.item-guide.is-selected {
	border-style: solid;
	border-color: #fff;
	background: rgba(255, 255, 255, 0.18);
	box-shadow:
		0 0 0 2px rgba(0, 0, 0, 0.7),
		0 0 0 5px rgba(59, 130, 246, 0.95);
}
</style>
