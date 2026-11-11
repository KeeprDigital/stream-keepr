<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { PreviewPoint, PreviewZoom } from '~/modules/graphics/previewControls';
import { useElementSize, useEventListener } from '@vueuse/core';
import { SCREEN_OUTPUT_OPTIONS } from '~~/shared/screenModeDefinitions';
import {
	clampPreviewZoom,
	PREVIEW_ZOOM_OPTIONS,
	previewZoomScroll,
	previewZoomShortcut,
	wheelPreviewZoom,
} from '~/modules/graphics/previewControls';
import { isTypingTarget } from '~/utils/typingTarget';

/**
 * The editor preview shared by the Broadcast Graphics and Feature Match Overlay
 * editors: output selection, zoom and pan, a viewport sized to the canvas aspect
 * ratio, and the item and advisory safe-area guide switches.
 *
 * The host owns the preview iframe (the `viewport` slot) and everything said to
 * it: it builds the preview URL from `output`, `itemGuides` and `safeAreaGuides`,
 * and keeps its own state in sync. The `controls` slot adds host controls to the
 * toolbar; the default slot sits between the toolbar and the viewport.
 *
 * The `animation` slot holds the host's Graphic Animation Preview controls,
 * behind one toolbar control that shows and hides them. They stay mounted while
 * hidden, because they hold the run: a loop keeps playing with its controls
 * closed, and `animationPlaying` marks the control so an author can tell why the
 * preview is moving.
 *
 * ## Zoom and pan
 *
 * Three boxes nest: the stage keeps the footprint Fit gives the preview at every
 * zoom, the scroller inside it scrolls, and the viewport is the canvas drawn at
 * the current scale. ⌘/Ctrl-wheel (or a pinch) zooms around the pointer;
 * Space-drag or a middle-button drag pans; ⌘0 fits and ⌘1 is 100%, but only while
 * the pointer or focus is in the preview, so the browser keeps them everywhere
 * else. The range is 10–800%. Zoom is view state: it never writes, needs no
 * Graphics Authoring Lease, and every visit starts at Fit.
 *
 * Whatever the host draws over its iframe in the viewport (the canvas
 * manipulation overlay) is sized with the canvas, so it follows the zoom; the
 * zoom holds still while a press in the viewport is dragging it. The iframe's
 * same-origin document keeps its wheel, key and pointer events to itself, so the
 * panel listens in it too.
 */
const props = withDefaults(defineProps<{
	canvasWidth: number;
	canvasHeight: number;
	/** A solid colour behind the viewport; omitted, it shows transparency. */
	background?: string;
	/** The tallest a fitted viewport is drawn, as a CSS length. Default: 46vh. */
	fitHeight?: string;
	/** Whether the panel can be collapsed. Default: true. */
	collapsible?: boolean;
	/** Whether the host's Graphic Animation Preview has a run playing. */
	animationPlaying?: boolean;
}>(), {
	collapsible: true,
});

const output = defineModel<ScreenOutput>('output', { default: 'overlay' });
const itemGuides = defineModel<boolean>('itemGuides', { default: true });
const safeAreaGuides = defineModel<boolean>('safeAreaGuides', { default: false });

/** View state, like zoom: every visit starts with the animation controls closed. */
const animationOpen = ref(false);
const animationRegionId = useId();

const stage = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const viewport = ref<HTMLElement | null>(null);

const zoom = ref<PreviewZoom>('fit');
const { width: stageWidth } = useElementSize(stage);
const scale = computed(() => {
	if (zoom.value !== 'fit')
		return zoom.value;
	return props.canvasWidth > 0
		? stageWidth.value / props.canvasWidth
		: 0;
});
/** Blank only until Fit has been measured. */
const zoomLevel = computed(() => scale.value > 0
	? `${Math.round(scale.value * 100)}%`
	: '');

const stageStyle = computed(() => ({
	aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`,
	width: props.fitHeight
		? `calc(${props.fitHeight} * ${props.canvasWidth / props.canvasHeight})`
		: `${46 * props.canvasWidth / props.canvasHeight}vh`,
	maxWidth: '100%',
}));

const viewportStyle = computed(() => [
	zoom.value === 'fit'
		? { width: '100%', height: '100%' }
		: {
				width: `${props.canvasWidth * zoom.value}px`,
				height: `${props.canvasHeight * zoom.value}px`,
			},
	props.background
		? { backgroundColor: props.background }
		: {},
]);

/**
 * A primary press in the viewport, such as a canvas manipulation drag. Its
 * deltas are measured at the scale it started at, so nothing rescales or pans
 * under it.
 */
const pressing = ref(false);

/**
 * Zoom to `next`, keeping the canvas point at `at` (in the scroller's visible
 * pixels; its centre when omitted) where it is.
 */
async function setZoom(next: PreviewZoom, at?: PreviewPoint) {
	const from = scale.value;
	zoom.value = next === 'fit'
		? 'fit'
		: clampPreviewZoom(next);
	const el = scroller.value;
	if (!el || zoom.value === 'fit' || from <= 0)
		return;
	const client = { width: el.clientWidth, height: el.clientHeight };
	const scroll = previewZoomScroll({
		canvas: { width: props.canvasWidth, height: props.canvasHeight },
		client,
		scroll: { left: el.scrollLeft, top: el.scrollTop },
		pointer: at ?? { x: client.width / 2, y: client.height / 2 },
		from,
		to: zoom.value,
	});
	await nextTick();
	el.scrollLeft = scroll.left;
	el.scrollTop = scroll.top;
}

/** Where the iframe's own viewport sits in this document's; none for this document's events. */
type DocumentOrigin = () => PreviewPoint;
const HERE: DocumentOrigin = () => ({ x: 0, y: 0 });

/** A pointer event's position in this document's viewport. */
function pointOf(event: MouseEvent, origin: DocumentOrigin): PreviewPoint {
	const { x, y } = origin();
	return { x: event.clientX + x, y: event.clientY + y };
}

function zoomByWheel(event: WheelEvent, origin: DocumentOrigin = HERE) {
	if (!(event.ctrlKey || event.metaKey) || !scroller.value)
		return;
	// A pinch arrives as a Ctrl-wheel too; either would otherwise zoom the page.
	event.preventDefault();
	if (pressing.value)
		return;
	const rect = scroller.value.getBoundingClientRect();
	const point = pointOf(event, origin);
	void setZoom(wheelPreviewZoom(scale.value, event), {
		x: point.x - rect.left,
		y: point.y - rect.top,
	});
}

const pointerInside = ref(false);

function focusInside() {
	return import.meta.client && !!stage.value?.contains(document.activeElement);
}

/**
 * Whether Space pressed at `target` arms panning: nothing else has focus, or
 * focus is in the preview, and nothing is being typed into.
 */
function spaceArmsPan(target: EventTarget | null, inPreviewDocument: boolean) {
	if (isTypingTarget(target))
		return false;
	if (inPreviewDocument)
		return true;
	const element = target as Node | null;
	return !element
		|| element === document.body
		|| element === document.documentElement
		|| !!stage.value?.contains(element);
}

/** Space is held: the next primary drag anywhere on the stage pans. */
const panArmed = ref(false);
const panning = shallowRef<{ from: PreviewPoint; left: number; top: number } | null>(null);

function isSpace(event: KeyboardEvent) {
	return event.code === 'Space' || event.key === ' ';
}

function handleKeydown(event: KeyboardEvent, inPreviewDocument = false) {
	if (event.defaultPrevented)
		return;
	const inside = inPreviewDocument || pointerInside.value || focusInside();
	const shortcut = previewZoomShortcut(event);
	if (shortcut !== null) {
		if (!inside)
			return;
		event.preventDefault();
		if (!pressing.value)
			void setZoom(shortcut);
		return;
	}
	if (isSpace(event) && !event.metaKey && !event.ctrlKey && !event.altKey && inside && !pressing.value
		&& spaceArmsPan(event.target, inPreviewDocument)) {
		event.preventDefault();
		panArmed.value = true;
	}
}

function handleKeyup(event: KeyboardEvent) {
	if (isSpace(event))
		panArmed.value = false;
}

function startPan(from: PreviewPoint) {
	const el = scroller.value;
	if (!el)
		return;
	panning.value = { from, left: el.scrollLeft, top: el.scrollTop };
}

function movePan(event: PointerEvent, origin: DocumentOrigin = HERE) {
	const pan = panning.value;
	const el = scroller.value;
	if (!pan || !el)
		return;
	const point = pointOf(event, origin);
	el.scrollLeft = pan.left - (point.x - pan.from.x);
	el.scrollTop = pan.top - (point.y - pan.from.y);
}

function release() {
	panning.value = null;
	pressing.value = false;
}

/** A middle press pans from anywhere on the stage. */
function startMiddlePan(event: PointerEvent, origin: DocumentOrigin = HERE) {
	if (event.button === 1)
		startPan(pointOf(event, origin));
}

function startSurfacePan(event: PointerEvent) {
	if (event.button !== 0)
		return;
	event.preventDefault();
	startPan(pointOf(event, HERE));
}

function notePress(event: PointerEvent) {
	if (event.button === 0)
		pressing.value = true;
}

/**
 * A middle press would otherwise start the browser's autoscroll. Cancelled on
 * `mousedown`, where autoscroll starts; cancelling `pointerdown` instead would
 * suppress this event rather than the autoscroll.
 */
function blockAutoscroll(event: MouseEvent) {
	if (event.button === 1)
		event.preventDefault();
}

const hostWindow = import.meta.client
	? window
	: undefined;
useEventListener(hostWindow, 'keydown', (event: KeyboardEvent) => handleKeydown(event));
useEventListener(hostWindow, 'keyup', handleKeyup);
useEventListener(hostWindow, 'blur', () => {
	panArmed.value = false;
	release();
});
useEventListener(hostWindow, 'pointermove', (event: PointerEvent) => movePan(event));
useEventListener(hostWindow, 'pointerup', release);
useEventListener(hostWindow, 'pointercancel', release);

function listen<K extends keyof WindowEventMap>(
	target: Window,
	type: K,
	listener: (event: WindowEventMap[K]) => void,
	options?: AddEventListenerOptions,
) {
	target.addEventListener(type, listener, options);
	return () => target.removeEventListener(type, listener, options);
}

let stopListeningInPreview: (() => void) | null = null;

/** Listen in the iframe's document, which every navigation of it replaces. */
function listenInPreviewDocument() {
	stopListeningInPreview?.();
	stopListeningInPreview = null;
	const iframe = viewport.value?.querySelector('iframe');
	let previewWindow: Window | null = null;
	try {
		previewWindow = iframe?.contentWindow ?? null;
		// A cross-origin document throws here, and is left alone.
		void previewWindow?.document;
	}
	catch {
		return;
	}
	if (!iframe || !previewWindow)
		return;
	const origin: DocumentOrigin = () => {
		const rect = iframe.getBoundingClientRect();
		return { x: rect.left, y: rect.top };
	};
	const stops = [
		listen(previewWindow, 'wheel', event => zoomByWheel(event, origin), { passive: false }),
		listen(previewWindow, 'keydown', event => handleKeydown(event, true)),
		listen(previewWindow, 'keyup', handleKeyup),
		listen(previewWindow, 'pointerdown', event => startMiddlePan(event, origin)),
		listen(previewWindow, 'mousedown', blockAutoscroll),
		listen(previewWindow, 'pointermove', event => movePan(event, origin)),
		listen(previewWindow, 'pointerup', release),
		listen(previewWindow, 'pointercancel', release),
	];
	stopListeningInPreview = () => stops.forEach(stop => stop());
}

onMounted(listenInPreviewDocument);
onBeforeUnmount(() => {
	stopListeningInPreview?.();
	stopListeningInPreview = null;
});
</script>

<template>
	<ScreenSettingsSection title="Preview" :default-open="true" :collapsible="collapsible">
		<template #actions="{ open }">
			<div v-if="open" class="flex flex-wrap items-center gap-3">
				<UFieldGroup size="sm">
					<UButton
						icon="i-lucide-square-dashed"
						:color="itemGuides ? 'primary' : 'neutral'"
						:variant="itemGuides ? 'subtle' : 'outline'"
						aria-label="Item guides"
						:aria-pressed="itemGuides"
						title="Item guides"
						data-testid="preview-item-guides"
						@click="() => { itemGuides = !itemGuides }"
					/>
					<UButton
						icon="i-lucide-scan"
						:color="safeAreaGuides ? 'primary' : 'neutral'"
						:variant="safeAreaGuides ? 'subtle' : 'outline'"
						aria-label="Safe areas"
						:aria-pressed="safeAreaGuides"
						title="Action-safe and title-safe guides"
						data-testid="preview-safe-area-guides"
						@click="() => { safeAreaGuides = !safeAreaGuides }"
					/>
				</UFieldGroup>
				<UFieldGroup size="sm">
					<UButton
						v-for="option in SCREEN_OUTPUT_OPTIONS"
						:key="option.value"
						:icon="option.icon"
						:color="output === option.value ? 'primary' : 'neutral'"
						:variant="output === option.value ? 'subtle' : 'outline'"
						:aria-label="`${option.label} preview output`"
						@click="() => { output = option.value }"
					>
						{{ option.label }}
					</UButton>
				</UFieldGroup>
				<div class="flex items-center gap-2">
					<UFieldGroup size="sm">
						<UButton
							v-for="option in PREVIEW_ZOOM_OPTIONS"
							:key="option.value"
							:color="zoom === option.value ? 'primary' : 'neutral'"
							:variant="zoom === option.value ? 'subtle' : 'outline'"
							:aria-label="`${option.label} preview zoom`"
							:aria-pressed="zoom === option.value"
							@click="setZoom(option.value)"
						>
							{{ option.label }}
						</UButton>
					</UFieldGroup>
					<span
						class="min-w-10 text-right font-mono text-xs tabular-nums text-muted"
						title="Preview zoom: ⌘/Ctrl-scroll to zoom, Space-drag to pan, ⌘0 fits, ⌘1 is 100%"
						data-testid="preview-zoom-level"
					>{{ zoomLevel }}</span>
				</div>
				<UButton
					v-if="$slots.animation"
					size="sm"
					:icon="animationPlaying ? 'i-lucide-circle-play' : 'i-lucide-clapperboard'"
					:trailing-icon="animationOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
					:color="animationOpen || animationPlaying ? 'primary' : 'neutral'"
					:variant="animationOpen || animationPlaying ? 'subtle' : 'outline'"
					:aria-label="animationPlaying ? 'Animation, playing' : 'Animation'"
					:aria-expanded="animationOpen"
					:aria-controls="animationRegionId"
					:title="animationPlaying ? 'An animation preview is playing' : 'Preview animation'"
					:data-playing="animationPlaying"
					data-testid="preview-animation-toggle"
					@click="() => { animationOpen = !animationOpen }"
				>
					Animation
				</UButton>
				<slot name="controls" />
			</div>
		</template>

		<div
			v-if="$slots.animation"
			v-show="animationOpen"
			:id="animationRegionId"
			data-testid="preview-animation-region"
		>
			<slot name="animation" />
		</div>

		<slot />

		<div
			ref="stage"
			class="relative mx-auto"
			:style="stageStyle"
			data-testid="preview-stage"
			@pointerenter="pointerInside = true"
			@pointerleave="pointerInside = false"
			@pointerdown="startMiddlePan($event)"
			@mousedown="blockAutoscroll"
			@wheel="zoomByWheel($event)"
		>
			<div
				ref="scroller"
				class="absolute inset-0 flex overflow-auto"
				data-testid="preview-scroller"
			>
				<div
					ref="viewport"
					class="relative m-auto shrink-0 overflow-hidden"
					:class="{ 'transparent-checkerboard-backdrop': !background }"
					:style="viewportStyle"
					data-testid="preview-viewport"
					@pointerdown.capture="notePress"
					@load.capture="listenInPreviewDocument"
				>
					<slot name="viewport" />
				</div>
			</div>
			<div
				v-if="panArmed || panning"
				class="absolute inset-0 z-10"
				:class="panning ? 'cursor-grabbing' : 'cursor-grab'"
				data-testid="preview-pan-surface"
				@pointerdown="startSurfacePan"
			/>
		</div>
	</ScreenSettingsSection>
</template>
