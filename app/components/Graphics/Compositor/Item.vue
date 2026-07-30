<script setup lang="ts">
import type { GraphicItemRenderDescriptor } from '~/modules/graphics/renderModel';
import { graphicTextClampLines } from '~/modules/graphics/renderModel';
import { fitGraphicTextFontSize } from '~/modules/graphics/textFit';

/**
 * One Graphic Item of a composed frame. Everything visual comes from the
 * compositor render model; the only work done here is the measurement a
 * `shrink` Text Overflow Policy needs, which no pure model can do.
 */
const props = defineProps<{ render: GraphicItemRenderDescriptor }>();

const bounds = ref<HTMLElement | null>(null);
const textElement = ref<HTMLElement | null>(null);
const fittedFontSize = ref<number | null>(null);

function pixelValue(value: unknown): number {
	return typeof value === 'string' ? Number.parseFloat(value) || 0 : 0;
}

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
		<p v-if="render.kind === 'text'" ref="textElement" :style="textStyle">
			{{ render.text }}
		</p>
	</div>
</template>
