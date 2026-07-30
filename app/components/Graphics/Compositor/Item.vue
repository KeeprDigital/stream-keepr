<script setup lang="ts">
import type { GraphicItemRenderDescriptor } from '~/modules/graphics/renderModel';
import { graphicTextClampLines } from '~/modules/graphics/renderModel';
import { fitGraphicTextFontSize } from '~/modules/graphics/textFit';

/**
 * One Graphic Item of a composed frame. Everything visual comes from the
 * compositor render model; the only work done here is the measurement a
 * `shrink` Text Overflow Policy needs, which no pure model can do.
 *
 * A Graphic Surface Style paints as one SVG path so a uniform outline follows
 * every corner treatment and edge slant. The surface is absolutely positioned
 * and stretches to the element's real box, so a weighted-fill Graphic Group
 * child paints its surface across the width its group actually gave it.
 *
 * A Graphic Group renders its children through this same component. Graphic
 * Groups do not nest, so that recursion is one level deep.
 */
const props = defineProps<{ render: GraphicItemRenderDescriptor }>();

const bounds = ref<HTMLElement | null>(null);
const textElement = ref<HTMLElement | null>(null);
const fittedFontSize = ref<number | null>(null);

function pixelValue(value: unknown): number {
	return typeof value === 'string' ? Number.parseFloat(value) || 0 : 0;
}

const surface = computed(() => props.render.surface);
const viewBox = computed(() => surface.value
	? `0 0 ${Math.max(surface.value.width, 0)} ${Math.max(surface.value.height, 0)}`
	: '0 0 0 0');

const textStyle = computed(() => {
	const base = props.render.textStyle;
	if (!base || fittedFontSize.value === null)
		return base;

	return {
		...base,
		fontSize: `${fittedFontSize.value}px`,
		WebkitLineClamp: graphicTextClampLines(
			pixelValue(props.render.style.height),
			fittedFontSize.value,
			Number(base.lineHeight ?? 1),
		),
	};
});

/** Measure the real element at each candidate size, then restore what the model set. */
function fitText() {
	const shrink = props.render.shrink;
	if (!shrink) {
		fittedFontSize.value = null;
		return;
	}

	const element = textElement.value;
	const box = bounds.value;
	if (!element || !box)
		return;

	const restore = {
		fontSize: element.style.fontSize,
		display: element.style.display,
		lineClamp: element.style.webkitLineClamp,
	};
	element.style.display = 'block';
	element.style.webkitLineClamp = 'unset';

	const size = fitGraphicTextFontSize(shrink, (candidate) => {
		element.style.fontSize = `${candidate}px`;
		return element.scrollHeight <= box.clientHeight && element.scrollWidth <= box.clientWidth;
	});

	element.style.fontSize = restore.fontSize;
	element.style.display = restore.display;
	element.style.webkitLineClamp = restore.lineClamp;
	fittedFontSize.value = size;
}

watch(
	() => [props.render.text, props.render.shrink, props.render.style, props.render.textStyle],
	() => fitText(),
	{ deep: true, flush: 'post', immediate: true },
);
</script>

<template>
	<div
		ref="bounds"
		class="graphics-compositor-item"
		:data-graphic-item-kind="render.kind"
		:style="render.style"
	>
		<svg
			v-if="surface"
			class="graphics-compositor-item__surface"
			:viewBox="viewBox"
			preserveAspectRatio="none"
			aria-hidden="true"
			focusable="false"
		>
			<defs>
				<linearGradient
					v-if="surface.fill.gradient"
					:id="surface.fill.gradient.id"
					:x1="surface.fill.gradient.x1"
					:y1="surface.fill.gradient.y1"
					:x2="surface.fill.gradient.x2"
					:y2="surface.fill.gradient.y2"
				>
					<stop
						v-for="(stop, index) in surface.fill.gradient.stops"
						:key="index"
						:offset="stop.offset"
						:stop-color="stop.color"
						:stop-opacity="stop.opacity"
					/>
				</linearGradient>
				<clipPath v-if="surface.outline" :id="surface.outline.clipId">
					<path :d="surface.path" />
				</clipPath>
			</defs>
			<path :d="surface.path" :fill="surface.fill.color" :fill-opacity="surface.fill.opacity" />
			<!--
				A uniform outline is an inner stroke: twice the authored width, clipped
				to the same path, so it hugs cut corners and slanted edges and never
				leaves the item's authored bounds.
			-->
			<path
				v-if="surface.outline"
				:d="surface.path"
				fill="none"
				:stroke="surface.outline.color"
				:stroke-width="surface.outline.width * 2"
				:clip-path="`url(#${surface.outline.clipId})`"
			/>
		</svg>

		<p v-if="render.kind === 'text'" ref="textElement" :style="textStyle">
			{{ render.text }}
		</p>

		<Item
			v-for="child in render.children"
			:key="child.id"
			:render="child"
		/>
	</div>
</template>

<style scoped>
.graphics-compositor-item__surface {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	display: block;
	overflow: visible;
	pointer-events: none;
}
</style>
