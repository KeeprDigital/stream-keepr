<script setup lang="ts">
import type { GraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import GraphicsCompositorGuideLayer from './GuideLayer.vue';
import GraphicsCompositorItem from './Item.vue';

/**
 * The shared compositor canvas: one composed transparent colour-and-opacity
 * frame from which the Overlay, Fill, and Key Outputs are derived. Both the
 * live Screen Output and the editor preview render this same component from the
 * same render model.
 *
 * Advisory guides appear only when the render model carries them, which only an
 * editor preview ever asks for — and only while this canvas is the Screen
 * Output's own. A `layer` composition is mounted inside a canvas its host
 * already paints, and that host draws the one guide layer over it, for the same
 * reason it paints the backdrop and places the layer.
 *
 * Each Broadcast Graphic already had its own wrapper so its items could not escape
 * its stacking context; whole-graphic Graphic Animation rides on that same wrapper,
 * which is what makes a graphic fade compose multiplicatively with its items' own.
 */
const props = defineProps<{ render: GraphicsCompositionRenderModel }>();

const emit = defineEmits<{ select: [target: GraphicsSelectionTarget] }>();

const ownsGuideLayer = computed(() => props.render.canvasRole === 'screen-output');
</script>

<template>
	<div
		class="graphics-compositor-canvas"
		:class="`graphics-compositor-canvas--${render.output}`"
		:style="render.canvasStyle"
	>
		<!--
			What a host paints behind the composition, filling the canvas and beneath
			every Broadcast Graphic — a Broadcast Graphics Screen's animated
			background is the first (#495).

			Inside this element rather than behind it, because a `screen-output`
			canvas paints the Screen Output's own backdrop (black for the Fill and Key
			Outputs), and anything drawn behind the element is behind that black. The
			positioning is this component's, since it owns the box; what is drawn, at
			what opacity, and in which outputs at all stay the host's.
		-->
		<div v-if="$slots.backdrop" class="graphics-compositor-canvas__backdrop">
			<slot name="backdrop" />
		</div>

		<template v-for="graphic in render.graphics" :key="graphic.id">
			<!--
				A Broadcast Graphic in two lifecycle phases at once needs two elements: the
				phase that moves what it draws sits on the frame below, and the phase that
				moves the *result* — an exit running over an update, or a second wipe that
				cannot share the frame's one mask — sits on this enclosure.

				It is drawn whether or not it carries anything, because it is free: it is
				`position: absolute; inset: 0` over a graphic that already fills the canvas,
				so an unstyled one composites identically to not being there. Making it
				conditional would mean two copies of the frames below for one class attribute.
			-->
			<div
				class="graphics-compositor-canvas__graphic"
				:data-broadcast-graphic-enclosure="graphic.id"
				:style="graphic.enclosingStyle"
			>
				<!--
					A *whole-graphic* update recipe moves the composed frame, so the frame being
					replaced is drawn as its own layer beneath the one arriving — which is what a
					cross-dissolve is, and the only case where two canvas-wide copies are right.
					A per-item cross-transition never comes through here: it pairs the two
					renderings inside the crossing item's own box, where Graphic Layer Order
					still composes.
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
			</div>
		</template>

		<GraphicsCompositorGuideLayer
			v-if="ownsGuideLayer"
			:item-guides="render.itemGuides"
			:safe-area-guides="render.safeAreaGuides"
			:selectable-canvas="render.itemGuides.length > 0"
			@select="emit('select', $event)"
		/>
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

.graphics-compositor-canvas__backdrop {
	position: absolute;
	inset: 0;
	overflow: hidden;
	pointer-events: none;
}
</style>
