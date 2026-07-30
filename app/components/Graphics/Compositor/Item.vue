<script setup lang="ts">
import type { GraphicItemRenderDescriptor, GraphicTextRenderSegment } from '~/modules/graphics/renderModel';
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
 * A Media Graphic Item renders one image or video element inside the item's
 * bounds. Everything about how it paints — fitting, focal position, opacity, and
 * the Key Output's alpha-as-white conversion — comes from the render model; the
 * element exists here only because a pure model cannot own a DOM node with a
 * playback rate.
 *
 * A Graphic Group renders its children through this same component. Graphic
 * Groups do not nest, so that recursion is one level deep.
 */
const props = defineProps<{ render: GraphicItemRenderDescriptor }>();

const bounds = ref<HTMLElement | null>(null);
const textElement = ref<HTMLElement | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const fittedFontSize = ref<number | null>(null);

const media = computed(() => props.render.media);
const actualVideoTarget = useGraphicsVideoTarget();

/**
 * A VP9-alpha silent video only plays in Chromium, so elsewhere the element is
 * withheld and a marked placeholder takes its place.
 *
 * The marker is a data attribute with no visible text: readable by a test or by a
 * developer inspecting the DOM, not by anyone looking at the output. Where it can
 * be seen is worth stating precisely, because the two cases differ.
 *
 * On a live Screen Output it is unreachable. The capability session is refused
 * outright when the Screen publishes a chromium-transparency revision to a
 * non-Chromium target, so no content URL resolves, every `src` is empty, and the
 * branch below never renders — the output loses all of its media, not just the
 * video it cannot play.
 *
 * In an editor preview it does render, because a preview resolves content as an
 * author rather than through a capability. That includes the Key preview, which is
 * why giving this real text is not a local change: visible text carries colour, and
 * colour in the Key Output breaks the alpha matte, so the decision has to come from
 * the render model that knows the output. Reporting either case to a person is
 * tracked on #98.
 */
const videoBlocked = computed(() => media.value?.videoCompatibility === 'chromium-transparency'
	&& actualVideoTarget.value !== 'chromium');

/**
 * Playback rate is set on the element rather than bound, because it is a property
 * with no attribute. The element is created when its Broadcast Graphic enters and
 * destroyed when it leaves, so playback starts from the beginning each time
 * without anything having to seek it there.
 */
watchEffect(() => {
	if (videoElement.value)
		videoElement.value.playbackRate = media.value?.playbackRate ?? 1;
});

function pixelValue(value: unknown): number {
	return typeof value === 'string' ? Number.parseFloat(value) || 0 : 0;
}

const surface = computed(() => props.render.surface);
/** A Text Graphic Item always has runs; a template with no placeholder has one. */
const textSegments = computed<GraphicTextRenderSegment[]>(() =>
	props.render.textSegments ?? [{ text: props.render.text ?? '' }],
);
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
	// `textSegments` is observed as well as `text`: a Graphic Placeholder Style edit
	// changes a run's typography without changing the rendered string, and the fitted
	// size depends on both.
	() => [
		props.render.text,
		props.render.textSegments,
		props.render.shrink,
		props.render.style,
		props.render.textStyle,
	],
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

		<!--
			Rendered as runs rather than one string so each `{inputKey}` run can carry
			its own Graphic Placeholder Style. Concatenating them is exactly the item's
			rendered text, so the `shrink` measurement above still measures what the
			viewer sees.
		-->
		<p v-if="render.kind === 'text'" ref="textElement" :style="textStyle">
			<span
				v-for="(segment, index) in textSegments"
				:key="index"
				:style="segment.style"
				:data-graphic-input-key="segment.inputKey"
			>{{ segment.text }}</span>
		</p>

		<!--
			A Media Graphic Item renders nothing at all without resolvable content: an
			empty `src` would be a broken element, and in the Key Output a broken
			element still paints a box.
		-->
		<template v-if="media && media.src !== ''">
			<video
				v-if="media.mediaKind === 'silent-video' && !videoBlocked"
				ref="videoElement"
				:src="media.src"
				:loop="media.loop"
				autoplay
				muted
				playsinline
				preload="auto"
				:style="media.style"
			/>
			<span
				v-else-if="media.mediaKind === 'silent-video'"
				data-video-compatibility-blocked="vp9-alpha-chromium-required"
			/>
			<!--
				Empty alt, deliberately. A Media Graphic Item is decorative — it carries
				no meaning a caption would convey — and a broken image draws its alt text
				inside the element's box, which in the Key Output would paint the authored
				label straight into the alpha matte in whatever colour it inherited. The
				render-model guard cannot catch that: it inspects the model, and this is a
				DOM failure mode.
			-->
			<img
				v-else
				:src="media.src"
				alt=""
				:style="media.style"
			>
		</template>

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
