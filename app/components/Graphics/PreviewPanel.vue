<script setup lang="ts">
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { PreviewZoom } from '~/modules/graphics/previewControls';
import { useElementSize, useEventListener } from '@vueuse/core';
import { SCREEN_OUTPUT_OPTIONS } from '~~/shared/screenModeDefinitions';
import {
	clampPreviewZoom,
	PREVIEW_ZOOM_OPTIONS,
	previewZoomScroll,
	previewZoomShortcut,
	wheelPreviewZoom,
} from '~/modules/graphics/previewControls';

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
 * ## Zoom and pan (#745)
 *
 * The preview keeps the footprint Fit gives it; zooming resizes the canvas inside
 * it, and the canvas scrolls. ⌘/Ctrl-wheel (or a pinch) zooms around the pointer,
 * Space-drag or a middle-button drag pans, ⌘0 fits and ⌘1 is 100% — the last two
 * only while the pointer or focus is in the preview, so the browser keeps them
 * everywhere else (E21). The range is 10–800% (E20). Zoom is view state: it never
 * writes, needs no Graphics Authoring Lease, and every visit starts at Fit (E22).
 *
 * Whatever the host draws over its frame in the viewport (the canvas manipulation
 * overlay) is sized with the canvas, so it follows the zoom. The frame is a
 * same-origin document whose wheel, key and pointer events never reach this one,
 * so the panel listens in it too.
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
}>(), {
	collapsible: true,
});

const output = defineModel<ScreenOutput>('output', { default: 'overlay' });
const itemGuides = defineModel<boolean>('itemGuides', { default: true });
const safeAreaGuides = defineModel<boolean>('safeAreaGuides', { default: false });

const frame = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const viewport = ref<HTMLElement | null>(null);

const zoom = ref<PreviewZoom>('fit');
const { width: frameWidth } = useElementSize(frame);
const scale = computed(() => {
	if (zoom.value !== 'fit')
		return zoom.value;
	return props.canvasWidth > 0
		? frameWidth.value / props.canvasWidth
		: 0;
});
const zoomLevel = computed(() => `${Math.round(scale.value * 100)}%`);

/** The box Fit draws the canvas in, which the preview keeps at every zoom. */
const frameStyle = computed(() => ({
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
 * Zoom to `next`, keeping the canvas point at `at` (in the scroller's visible
 * pixels; its centre when omitted) where it is.
 */
async function setZoom(next: PreviewZoom, at?: { x: number; y: number }) {
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

/** How far a frame's own viewport sits from this document's. */
interface Offset { x: number; y: number }
const NO_OFFSET: Offset = { x: 0, y: 0 };

function zoomByWheel(event: WheelEvent, offset: Offset = NO_OFFSET) {
	if (!(event.ctrlKey || event.metaKey) || !scroller.value)
		return;
	// A pinch arrives as a Ctrl-wheel too; either would otherwise zoom the page.
	event.preventDefault();
	const rect = scroller.value.getBoundingClientRect();
	void setZoom(wheelPreviewZoom(scale.value, event), {
		x: event.clientX + offset.x - rect.left,
		y: event.clientY + offset.y - rect.top,
	});
}

const pointerInside = ref(false);

function focusInside() {
	return import.meta.client && !!frame.value?.contains(document.activeElement);
}

/** Whether a key press belongs to something the author is typing into or choosing in. */
function isTypingTarget(target: EventTarget | null) {
	const element = target as HTMLElement | null;
	if (!element || typeof element.closest !== 'function')
		return false;
	if (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
		return true;
	return element.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

/**
 * Whether Space pressed at `target` is the preview's to take: nothing else has
 * focus, or focus is in the preview, and nothing is being typed into.
 */
function spaceIsOurs(target: EventTarget | null, fromFrame: boolean) {
	if (isTypingTarget(target))
		return false;
	if (fromFrame)
		return true;
	const element = target as Node | null;
	return !element
		|| element === document.body
		|| element === document.documentElement
		|| !!frame.value?.contains(element);
}

const panArmed = ref(false);
const panning = shallowRef<{ x: number; y: number; left: number; top: number } | null>(null);

function isSpace(event: KeyboardEvent) {
	return event.code === 'Space' || event.key === ' ';
}

function handleKeydown(event: KeyboardEvent, fromFrame = false) {
	if (event.defaultPrevented)
		return;
	const inside = fromFrame || pointerInside.value || focusInside();
	const shortcut = previewZoomShortcut(event);
	if (shortcut !== null) {
		if (!inside)
			return;
		event.preventDefault();
		void setZoom(shortcut);
		return;
	}
	if (isSpace(event) && !event.metaKey && !event.ctrlKey && !event.altKey && inside && spaceIsOurs(event.target, fromFrame)) {
		event.preventDefault();
		panArmed.value = true;
	}
}

function handleKeyup(event: KeyboardEvent) {
	if (isSpace(event))
		panArmed.value = false;
}

function startPan(x: number, y: number) {
	const el = scroller.value;
	if (!el)
		return;
	panning.value = {
		x,
		y,
		left: el.scrollLeft,
		top: el.scrollTop,
	};
}

function movePan(x: number, y: number) {
	const pan = panning.value;
	const el = scroller.value;
	if (!pan || !el)
		return;
	el.scrollLeft = pan.left - (x - pan.x);
	el.scrollTop = pan.top - (y - pan.y);
}

function endPan() {
	panning.value = null;
}

function startMiddlePan(event: PointerEvent, offset: Offset = NO_OFFSET) {
	if (event.button !== 1)
		return;
	event.preventDefault();
	startPan(event.clientX + offset.x, event.clientY + offset.y);
}

function startSurfacePan(event: PointerEvent) {
	if (event.button !== 0)
		return;
	event.preventDefault();
	startPan(event.clientX, event.clientY);
}

/** A middle press would otherwise start the browser's autoscroll. */
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
	endPan();
});
useEventListener(hostWindow, 'pointermove', (event: PointerEvent) => movePan(event.clientX, event.clientY));
useEventListener(hostWindow, 'pointerup', endPan);
useEventListener(hostWindow, 'pointercancel', endPan);

let detachFrame: (() => void) | null = null;

/** Listen in the host's preview frame, whose document a navigation replaces. */
function attachFrame() {
	detachFrame?.();
	detachFrame = null;
	const iframe = viewport.value?.querySelector('iframe');
	let frameWindow: Window | null = null;
	try {
		frameWindow = iframe?.contentWindow ?? null;
		// A cross-origin frame throws here, and is left alone.
		void frameWindow?.document;
	}
	catch {
		return;
	}
	if (!iframe || !frameWindow)
		return;
	const offset = (): Offset => {
		const rect = iframe.getBoundingClientRect();
		return { x: rect.left, y: rect.top };
	};
	const listeners: Array<[string, (event: any) => void, AddEventListenerOptions?]> = [
		[
			'wheel',
			(event: WheelEvent) => zoomByWheel(event, offset()),
			{ passive: false },
		],
		[
			'keydown',
			(event: KeyboardEvent) => handleKeydown(event, true),
		],
		['keyup', handleKeyup],
		[
			'pointerdown',
			(event: PointerEvent) => startMiddlePan(event, offset()),
		],
		['mousedown', blockAutoscroll],
		[
			'pointermove',
			(event: PointerEvent) => {
				const { x, y } = offset();
				movePan(event.clientX + x, event.clientY + y);
			},
		],
		['pointerup', endPan],
		['pointercancel', endPan],
	];
	const target = frameWindow;
	for (const [type, listener, options] of listeners)
		target.addEventListener(type, listener, options);
	detachFrame = () => {
		for (const [type, listener, options] of listeners)
			target.removeEventListener(type, listener, options);
	};
}

onMounted(attachFrame);
onBeforeUnmount(() => {
	detachFrame?.();
	detachFrame = null;
});
</script>

<template>
	<ScreenSettingsCard title="Preview" :default-open="true" :collapsible="collapsible">
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
				<slot name="controls" />
			</div>
		</template>

		<slot />

		<div
			ref="frame"
			class="relative mx-auto"
			:style="frameStyle"
			data-testid="preview-frame"
			@pointerenter="pointerInside = true"
			@pointerleave="pointerInside = false"
			@pointerdown="startMiddlePan"
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
					@load.capture="attachFrame"
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
	</ScreenSettingsCard>
</template>
