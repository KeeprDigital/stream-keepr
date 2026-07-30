<script setup lang="ts">
import type { GraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import GraphicsCompositorItem from './Item.vue';

/**
 * The shared compositor canvas: one composed transparent colour-and-opacity
 * frame from which the Overlay, Fill, and Key Outputs are derived. Both the
 * live Screen Output and the editor preview render this same component from the
 * same render model.
 *
 * Advisory guides appear only when the render model carries them, which only an
 * editor preview ever asks for.
 *
 * Each Broadcast Graphic already had its own wrapper so its items could not escape
 * its stacking context; whole-graphic Graphic Animation rides on that same wrapper,
 * which is what makes a graphic fade compose multiplicatively with its items' own.
 */
const props = defineProps<{ render: GraphicsCompositionRenderModel }>();

const emit = defineEmits<{ select: [target: GraphicsSelectionTarget] }>();

const hasGuideLayer = computed(() =>
	props.render.itemGuides.length > 0 || props.render.safeAreaGuides.length > 0,
);
</script>

<template>
	<div
		class="graphics-compositor-canvas"
		:class="`graphics-compositor-canvas--${render.output}`"
		:style="render.canvasStyle"
	>
		<template v-for="graphic in render.graphics" :key="graphic.id">
			<!--
				The rendering an update phase is leaving, drawn under the one arriving so
				new content is in front of old as a wipe boundary passes over it. It is a
				sibling wrapper rather than a layer inside the graphic's own, because the
				two renderings carry different whole-graphic motion.
			-->
			<div
				v-if="graphic.outgoing"
				class="graphics-compositor-canvas__graphic"
				:data-broadcast-graphic-outgoing="graphic.id"
				:style="graphic.outgoing.style"
				aria-hidden="true"
			>
				<GraphicsCompositorItem
					v-for="item in graphic.outgoing.items"
					:key="item.id"
					:render="item"
				/>
			</div>

			<div
				class="graphics-compositor-canvas__graphic"
				:data-broadcast-graphic="graphic.id"
				:style="graphic.style"
			>
				<GraphicsCompositorItem
					v-for="item in graphic.items"
					:key="item.id"
					:render="item"
				/>
			</div>
		</template>

		<div v-if="hasGuideLayer" class="guide-layer" aria-label="Graphics compositor guide layer">
			<button
				v-if="render.itemGuides.length"
				type="button"
				class="canvas-guide"
				aria-label="Select canvas"
				@click.stop="emit('select', { type: 'canvas' })"
			/>
			<div
				v-for="guide in render.safeAreaGuides"
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
				v-for="guide in render.itemGuides"
				:key="`${guide.graphicId}:${guide.itemId}`"
				class="item-guide"
				:class="{ 'is-selected': guide.selected, 'is-in-selected-graphic': guide.inSelectedGraphic }"
				:data-in-selected-graphic="String(guide.inSelectedGraphic)"
				:style="guide.style"
				role="button"
				tabindex="0"
				:aria-label="`Select ${guide.label}`"
				@click.stop="emit('select', { type: 'item', graphicId: guide.graphicId, itemId: guide.itemId })"
				@keydown.enter.stop="emit('select', { type: 'item', graphicId: guide.graphicId, itemId: guide.itemId })"
				@keydown.space.prevent.stop="emit('select', { type: 'item', graphicId: guide.graphicId, itemId: guide.itemId })"
			>
				<span>{{ guide.label }}</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.graphics-compositor-canvas {
	isolation: isolate;
}

.graphics-compositor-canvas__graphic {
	position: absolute;
	inset: 0;
}

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
