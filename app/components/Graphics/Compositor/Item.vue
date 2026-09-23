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
 *
 * The context-gated kinds render here too rather than in a Feature Match
 * hierarchy. A Clock and a Player Life are text whose string the host resolved, so
 * they take the same paragraph, typography, and `shrink` measurement a Text
 * Graphic Item does. A Game Wins indicator is either that same text or a row of
 * painted Shape Geometry boxes. A Deck List Item's list view is that same resolved
 * text again, one row per card; its grid view is a set of card cells, each an
 * image or a painted placeholder surface. Only the life-change animation is
 * local, because it fires on a value arriving from the live session rather than
 * on a lifecycle phase the render model projects.
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
 * withheld and a diagnostic placeholder takes its place.
 *
 * The decision splits across two owners, because neither knows the other's half.
 * Whether *this browser* can play the clip is a runtime fact, asked for here. What
 * the placeholder may then paint comes from the render model as
 * `incompatibilityNotice`, because only the model knows which Screen Output it is
 * building: the Key Output renders composed opacity as an alpha matte, so legible
 * text there would key the message onto program. The model withholds the notice
 * for that output and the placeholder stays empty, exactly as it did everywhere
 * before #98.
 *
 * The marker attribute is unconditional either way, so a test or a developer
 * inspecting the DOM reads the same thing in every output.
 *
 * This is reachable on a live Screen Output. Before #98 it was not: the capability
 * session was refused outright when a Screen published a chromium-transparency
 * revision to a non-Chromium target, so no content URL resolved, every `src` was
 * empty, and the output lost all of its media rather than this one clip. The
 * refusal is now per resolution request, so every other reference still resolves
 * and this branch renders where the clip would have been.
 *
 * The `videoCompatibility` read here is reconciled before it arrives. It starts as
 * the value the Media Graphic Item's configuration carries, which the write path
 * keeps equal to the pinned revision's recorded `technical_facts` — a
 * silent-video reference that states no compatibility, or states one the revision
 * contradicts, is refused publication. But that equality holds at the moment of
 * writing, and the facts can change under a configuration that already published.
 * Where they have, the render model takes the authoritative refusal over the
 * recorded copy, so this branch renders for a clip the server will not deliver
 * even though the configuration says it would (#184). Believing the copy alone was
 * what left an output drawing a `<video>` for bytes it was about to be refused,
 * with the notice suppressed because nothing thought there was anything to report.
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

/**
 * Whether this item paints text at all.
 *
 * Asked of the model rather than of the kind: a Game Wins indicator is text in its
 * `number` display mode and painted boxes in its `boxes` one, so the kind alone
 * does not answer it, while the presence of a resolved typography does.
 */
const rendersText = computed(() => props.render.textStyle !== undefined);

/**
 * The life-change animation, restarted by re-keying the element.
 *
 * A CSS animation only runs when the element is new, so the key is what makes a
 * second change to the same total animate again.
 *
 * An output joining mid-match must not flash every life total the moment it
 * connects, and the transition that would cause that is the one out of the empty
 * state: a Player Life renders nothing until the session holds a total, so the
 * first value arriving reads as a change from `''`. Guarding on the values rather
 * than on a mount tick is what makes that precise. A guard that skipped the first
 * fire instead would depend on whether the store already held the match when this
 * mounted — the watcher does not run on mount, so with data already present the
 * first *genuine* life change would be the one swallowed.
 */
const lifeChange = computed(() => props.render.lifeChange);
const lifeAnimationKey = ref(0);

watch(() => props.render.text, (next, previous) => {
	// Arriving at or departing from the empty state is the session gaining or
	// losing a total, which is not a life change.
	if (!next || !previous || next === previous)
		return;
	if (lifeChange.value && lifeChange.value.animation !== 'none')
		lifeAnimationKey.value += 1;
});

const lifeClass = computed(() => {
	const animation = lifeChange.value?.animation;
	return animation && animation !== 'none' ? `graphics-compositor-item--life-${animation}` : undefined;
});

const lifeStyle = computed(() => lifeChange.value
	? {
			'--life-animation-duration': `${lifeChange.value.durationMs}ms`,
			'--life-animation-accent': lifeChange.value.accentColor,
		}
	: undefined);
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
	<!--
		A Graphic Item whose concurrent lifecycle phases each wipe is drawn inside one
		extra element, because CSS allows one mask per element. This one is the item's
		own box carrying the second wipe; the item fills it and carries everything else,
		including whatever Shape Geometry clipping it already had.
	-->
	<div
		v-if="render.enclosed"
		class="graphics-compositor-item"
		:data-graphic-item-enclosure="render.id"
		:style="render.style"
	>
		<Item :render="render.enclosed" />
	</div>

	<!-- One Social Profile Presentation Group sampled as bounded correlated layers. -->
	<div
		v-else-if="render.presentationLayers"
		class="graphics-compositor-item"
		:data-social-profile-presentation="render.id"
		:style="render.style"
	>
		<Item
			v-for="(layer, index) in render.presentationLayers"
			:key="`${layer.id}-${index}`"
			:render="layer"
			:aria-hidden="index < render.presentationLayers.length - 1"
		/>
	</div>

	<!--
		A cross-transitioning Graphic Item is a positioning box holding both renderings,
		the arriving one in front of the one it replaces. Both fill this box, so the pair
		occupies exactly this item's place in Graphic Layer Order rather than a layer of
		its own — which is what stops an opaque item below covering the old rendering.
	-->
	<div
		v-else-if="render.crossTransition"
		class="graphics-compositor-item"
		:data-graphic-item-cross-transition="render.id"
		:style="render.style"
	>
		<Item :render="render.crossTransition.outgoing" aria-hidden="true" />
		<Item :render="render.crossTransition.incoming" />
	</div>

	<div
		v-else
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
		<p
			v-if="rendersText"
			:key="lifeAnimationKey"
			ref="textElement"
			:class="lifeClass"
			:style="{ ...textStyle, ...lifeStyle }"
		>
			<span
				v-for="(segment, index) in textSegments"
				:key="index"
				:style="segment.style"
				:data-graphic-input-key="segment.inputKey"
				:aria-label="segment.manaColors ? segment.text : undefined"
			>
				<span
					v-if="segment.manaColors?.monochrome"
					class="graphics-compositor-item__mana-colors-key"
					data-mana-colors-key
					aria-hidden="true"
				>
					<span
						v-for="symbol in segment.manaColors.symbolCount"
						:key="symbol"
						class="graphics-compositor-item__mana-color-key-symbol"
					/>
				</span>
				<MtgManaColorDisplay
					v-else-if="segment.manaColors"
					:colors="segment.manaColors.colors"
					size="lg"
					cost
					data-mana-colors
					aria-hidden="true"
				/>
				<template v-else>{{ segment.text }}</template>
			</span>
		</p>

		<!--
			A game-win indicator's boxes. Each is an ordinary painted Shape Geometry, so
			a won box differs from an unwon one only by the Graphic Surface Style the
			model resolved for it.
		-->
		<div
			v-for="(box, index) in render.winBoxes"
			:key="`box-${index}`"
			class="graphics-compositor-item__win-box"
			:data-game-win="box.won ? 'won' : 'pending'"
			:style="box.style"
		>
			<svg
				:viewBox="`0 0 ${Math.max(box.surface.width, 0)} ${Math.max(box.surface.height, 0)}`"
				preserveAspectRatio="none"
				aria-hidden="true"
				focusable="false"
			>
				<defs>
					<linearGradient
						v-if="box.surface.fill.gradient"
						:id="box.surface.fill.gradient.id"
						:x1="box.surface.fill.gradient.x1"
						:y1="box.surface.fill.gradient.y1"
						:x2="box.surface.fill.gradient.x2"
						:y2="box.surface.fill.gradient.y2"
					>
						<stop
							v-for="(stop, stopIndex) in box.surface.fill.gradient.stops"
							:key="stopIndex"
							:offset="stop.offset"
							:stop-color="stop.color"
							:stop-opacity="stop.opacity"
						/>
					</linearGradient>
					<clipPath v-if="box.surface.outline" :id="box.surface.outline.clipId">
						<path :d="box.surface.path" />
					</clipPath>
				</defs>
				<path
					:d="box.surface.path"
					:fill="box.surface.fill.color"
					:fill-opacity="box.surface.fill.opacity"
				/>
				<path
					v-if="box.surface.outline"
					:d="box.surface.path"
					fill="none"
					:stroke="box.surface.outline.color"
					:stroke-width="box.surface.outline.width * 2"
					:clip-path="`url(#${box.surface.outline.clipId})`"
				/>
			</svg>
		</div>

		<!--
			A Deck List Item's grid cards. Art is contained, never cropped; a card with no
			art paints a 63:88 placeholder surface carrying its own name, so the count
			stays honest. The quantity badge appears only when the model offers one.
			Empty alt for the same reason a Media Graphic Item's: a broken image would
			draw its alt text into the Key Output's matte.
		-->
		<div
			v-for="(card, index) in render.deckList?.cards"
			:key="`card-${index}`"
			class="graphics-compositor-item__deck-card"
			:data-deck-card="card.name"
			:style="card.style"
		>
			<img
				v-if="card.image"
				:src="card.image.src"
				alt=""
				:style="card.image.style"
			>
			<template v-else-if="card.placeholder">
				<svg
					:viewBox="`0 0 ${Math.max(card.placeholder.surface.width, 0)} ${Math.max(card.placeholder.surface.height, 0)}`"
					preserveAspectRatio="none"
					aria-hidden="true"
					focusable="false"
				>
					<defs>
						<linearGradient
							v-if="card.placeholder.surface.fill.gradient"
							:id="card.placeholder.surface.fill.gradient.id"
							:x1="card.placeholder.surface.fill.gradient.x1"
							:y1="card.placeholder.surface.fill.gradient.y1"
							:x2="card.placeholder.surface.fill.gradient.x2"
							:y2="card.placeholder.surface.fill.gradient.y2"
						>
							<stop
								v-for="(stop, stopIndex) in card.placeholder.surface.fill.gradient.stops"
								:key="stopIndex"
								:offset="stop.offset"
								:stop-color="stop.color"
								:stop-opacity="stop.opacity"
							/>
						</linearGradient>
						<clipPath v-if="card.placeholder.surface.outline" :id="card.placeholder.surface.outline.clipId">
							<path :d="card.placeholder.surface.path" />
						</clipPath>
					</defs>
					<path
						:d="card.placeholder.surface.path"
						:fill="card.placeholder.surface.fill.color"
						:fill-opacity="card.placeholder.surface.fill.opacity"
					/>
					<path
						v-if="card.placeholder.surface.outline"
						:d="card.placeholder.surface.path"
						fill="none"
						:stroke="card.placeholder.surface.outline.color"
						:stroke-width="card.placeholder.surface.outline.width * 2"
						:clip-path="`url(#${card.placeholder.surface.outline.clipId})`"
					/>
				</svg>
				<span :style="card.placeholder.textStyle">{{ card.name }}</span>
			</template>
			<span
				v-if="card.badge"
				data-deck-card-quantity
				:style="card.badge.style"
			>{{ card.badge.text }}</span>
		</div>

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
				:style="media.incompatibilityNotice?.style"
			>{{ media.incompatibilityNotice?.text }}</span>
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

		<UIcon
			v-if="render.icon"
			:name="render.icon.name"
			:style="render.icon.style"
			aria-hidden="true"
			data-social-network-icon
		/>

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

.graphics-compositor-item__win-box > svg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	display: block;
	overflow: visible;
	pointer-events: none;
}

.graphics-compositor-item__deck-card > svg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	display: block;
	overflow: visible;
	pointer-events: none;
}

.graphics-compositor-item__mana-colors-key {
	display: inline-flex;
	align-items: center;
	gap: 0.1em;
	vertical-align: middle;
}

.graphics-compositor-item__mana-color-key-symbol {
	display: inline-block;
	width: 1.15em;
	height: 1.15em;
	flex: 0 0 auto;
	border-radius: 9999px;
	background: #fff;
}

/*
 * A life total's change animation. It marks a value arriving from the live
 * session, which is why it lives here rather than in a Graphic Animation Recipe:
 * the shared vocabulary's phases are lifecycle positions, and a life total
 * changing is not one of them.
 */
.graphics-compositor-item--life-fade {
	animation: graphics-life-fade var(--life-animation-duration, 420ms) ease-out both;
}

.graphics-compositor-item--life-pop {
	animation: graphics-life-pop var(--life-animation-duration, 420ms) cubic-bezier(0.2, 0.9, 0.2, 1) both;
}

.graphics-compositor-item--life-slide {
	animation: graphics-life-slide var(--life-animation-duration, 420ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.graphics-compositor-item--life-glow {
	animation: graphics-life-glow var(--life-animation-duration, 420ms) ease-out both;
}

@keyframes graphics-life-fade {
	0% {
		opacity: 0.35;
	}
	100% {
		opacity: 1;
	}
}

@keyframes graphics-life-pop {
	0% {
		transform: scale(0.92);
		opacity: 0.75;
	}
	55% {
		transform: scale(1.08);
		opacity: 1;
	}
	100% {
		transform: scale(1);
		opacity: 1;
	}
}

@keyframes graphics-life-slide {
	0% {
		transform: translateY(0.18em);
		opacity: 0;
	}
	100% {
		transform: translateY(0);
		opacity: 1;
	}
}

@keyframes graphics-life-glow {
	0% {
		text-shadow: 0 0 0 transparent;
		filter: brightness(1);
	}
	35% {
		text-shadow: 0 0 0.35em var(--life-animation-accent, #fff);
		filter: brightness(1.25);
	}
	100% {
		text-shadow: 0 0 0 transparent;
		filter: brightness(1);
	}
}
</style>
