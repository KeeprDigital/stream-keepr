<script setup lang="ts">
import type { BroadcastGraphicConfig, GraphicAnimationPhase } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsPreviewAnimationScope } from '~/modules/graphics/previewMessages';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { GRAPHIC_ANIMATION_PHASE_LABELS } from '~~/shared/modules/graphics';
import { GRAPHIC_ANIMATION_PHASE_VALUES } from '~~/shared/types/graphics';
import { screenOutputPath } from '~~/shared/utils/screenOutput';
import {
	GRAPHICS_PREVIEW_STATE_MESSAGE,
	isGraphicsPreviewSelectMessage,
} from '~/modules/graphics/previewMessages';
import { graphicsSelectionGraphicId } from '~/modules/graphics/selection';

/**
 * The shared graphics preview: output selection, zoom, item selection and item
 * guides, advisory action-safe and title-safe guides, and Graphic Animation
 * Preview.
 *
 * The preview is a real Screen Output frame, asked explicitly for its guides.
 * A live Screen Output is never asked, so no guide can reach one.
 *
 * ## Graphic Animation Preview touches nothing live
 *
 * Playback is a *plan* pushed into the frame — which Broadcast Graphic, how much
 * of its lifecycle, how fast, whether it loops — and the frame runs its own clock
 * over the working composition it was already given. Nothing here writes Screen
 * configuration, opens a Broadcast Graphics Live Session, or accepts a Graphic
 * Input: the preview's only channel to the frame is this one message, and the
 * frame's only channel back is a selection.
 *
 * There is no playhead and no scrubbing. `run` is a token, not a time: bumping it
 * starts a run over, which is the only control an author has over *when*.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{ selectTarget: [target: GraphicsSelectionTarget] }>();

const OUTPUT_OPTIONS = [
	{ label: 'Overlay', value: 'overlay', icon: 'i-lucide-layers' },
	{ label: 'Fill', value: 'fill', icon: 'i-lucide-square' },
	{ label: 'Key', value: 'key', icon: 'i-lucide-contrast' },
] satisfies Array<{ label: string; value: ScreenOutput; icon: string }>;

const PREVIEW_ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '50%', value: '0.5' },
	{ label: '100%', value: '1' },
] as const;

type PreviewZoom = typeof PREVIEW_ZOOM_OPTIONS[number]['value'];

const ANIMATION_PHASE_OPTIONS = GRAPHIC_ANIMATION_PHASE_VALUES.map(phase => ({
	label: GRAPHIC_ANIMATION_PHASE_LABELS[phase],
	value: phase,
}));

const ANIMATION_SPEED_OPTIONS = [
	{ label: '0.25x', value: 0.25 },
	{ label: '0.5x', value: 0.5 },
	{ label: '1x', value: 1 },
	{ label: '2x', value: 2 },
] as const;

const previewOutput = ref<ScreenOutput>('overlay');
const previewZoom = ref<PreviewZoom>('fit');
const itemGuides = ref(true);
const safeAreaGuides = ref(false);
const previewFrame = ref<HTMLIFrameElement | null>(null);

const animationPhase = ref<GraphicAnimationPhase>('enter');
const animationScope = ref<GraphicsPreviewAnimationScope>('phase');
const animationSpeed = ref<number>(1);
const animationLoop = ref(false);
/** Zero means nothing is playing; every start bumps it. */
const animationRun = ref(0);

/**
 * The Broadcast Graphic a run applies to: the one under authoring. Selecting a
 * Graphic Item previews the graphic that contains it, because a recipe on an item
 * only means anything inside its graphic's own lifecycle phase.
 */
const previewGraphicId = computed(() => graphicsSelectionGraphicId(props.selectedTarget));

const animationPlan = computed(() => {
	const graphicId = previewGraphicId.value;
	if (animationRun.value === 0 || !graphicId)
		return null;

	return {
		graphicId,
		scope: animationScope.value,
		phase: animationPhase.value,
		run: animationRun.value,
		speed: animationSpeed.value,
		loop: animationLoop.value,
	};
});

function playAnimation() {
	animationRun.value += 1;
}

/** Stop and settle at the Graphic Resting State, which is where authoring happens. */
function stopAnimation() {
	animationRun.value = 0;
}

// A selection that leaves the Broadcast Graphic being previewed stops the run
// rather than silently animating something the author is no longer looking at.
watch(previewGraphicId, (graphicId, previous) => {
	if (graphicId !== previous)
		stopAnimation();
});

const previewUrl = computed(() => screenOutputPath({
	eventId: props.eventId,
	screenSlug: props.screen.slug,
	output: previewOutput.value,
	preview: true,
	itemGuides: itemGuides.value,
	safeAreaGuides: safeAreaGuides.value,
}));

const previewAspectStyle = computed(() => (previewZoom.value === 'fit'
	? { aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`, maxHeight: '46vh' }
	: {
			width: `${props.canvasWidth * Number(previewZoom.value)}px`,
			height: `${props.canvasHeight * Number(previewZoom.value)}px`,
			maxWidth: 'none',
		}));

function pushPreviewState() {
	if (!import.meta.client || !previewFrame.value?.contentWindow)
		return;

	previewFrame.value.contentWindow.postMessage({
		type: GRAPHICS_PREVIEW_STATE_MESSAGE,
		state: {
			graphics: JSON.parse(JSON.stringify(props.graphics)),
			selectedTarget: { ...props.selectedTarget },
			animation: animationPlan.value,
		},
	}, window.location.origin);
}

function handlePreviewSelection(message: MessageEvent) {
	if (!isGraphicsPreviewSelectMessage(message, {
		origin: window.location.origin,
		source: previewFrame.value?.contentWindow ?? null,
	})) {
		return;
	}

	emit('selectTarget', message.data.target);
}

onMounted(() => {
	window.addEventListener('message', handlePreviewSelection);
});

onBeforeUnmount(() => {
	window.removeEventListener('message', handlePreviewSelection);
});

watch(
	() => [props.graphics, props.selectedTarget, animationPlan.value] as const,
	() => pushPreviewState(),
	{ deep: true },
);
</script>

<template>
	<ScreenSettingsCard title="Preview" :default-open="true">
		<template #actions="{ open }">
			<div v-if="open" class="flex flex-wrap items-center gap-3">
				<UFormField label="Item guides" size="xs" class="flex items-center gap-2">
					<USwitch v-model="itemGuides" size="sm" data-testid="compositor-item-guides" />
				</UFormField>
				<UFormField label="Safe areas" size="xs" class="flex items-center gap-2">
					<USwitch v-model="safeAreaGuides" size="sm" data-testid="compositor-safe-area-guides" />
				</UFormField>
				<UFieldGroup size="sm">
					<UButton
						v-for="output in OUTPUT_OPTIONS"
						:key="output.value"
						:icon="output.icon"
						:color="previewOutput === output.value ? 'primary' : 'neutral'"
						:variant="previewOutput === output.value ? 'subtle' : 'outline'"
						:aria-label="`${output.label} preview output`"
						@click="() => { previewOutput = output.value }"
					>
						{{ output.label }}
					</UButton>
				</UFieldGroup>
				<UFieldGroup size="sm">
					<UButton
						v-for="zoom in PREVIEW_ZOOM_OPTIONS"
						:key="zoom.value"
						:color="previewZoom === zoom.value ? 'primary' : 'neutral'"
						:variant="previewZoom === zoom.value ? 'subtle' : 'outline'"
						:aria-label="`${zoom.label} preview zoom`"
						@click="() => { previewZoom = zoom.value }"
					>
						{{ zoom.label }}
					</UButton>
				</UFieldGroup>
			</div>
		</template>

		<div
			class="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-default/70 p-2"
			data-testid="animation-preview-controls"
		>
			<span class="text-xs font-semibold text-muted">Animation</span>
			<USelectMenu
				:model-value="animationPhase"
				:items="ANIMATION_PHASE_OPTIONS"
				value-key="value"
				size="xs"
				class="w-32"
				aria-label="Preview lifecycle phase"
				data-testid="animation-preview-phase"
				@update:model-value="value => { animationPhase = value }"
			/>
			<UFieldGroup size="xs">
				<UButton
					:color="animationScope === 'phase' ? 'primary' : 'neutral'"
					:variant="animationScope === 'phase' ? 'subtle' : 'outline'"
					data-testid="animation-preview-scope-phase"
					@click="() => { animationScope = 'phase' }"
				>
					Phase
				</UButton>
				<UButton
					:color="animationScope === 'lifecycle' ? 'primary' : 'neutral'"
					:variant="animationScope === 'lifecycle' ? 'subtle' : 'outline'"
					data-testid="animation-preview-scope-lifecycle"
					@click="() => { animationScope = 'lifecycle' }"
				>
					Lifecycle
				</UButton>
			</UFieldGroup>
			<UFieldGroup size="xs">
				<UButton
					v-for="speed in ANIMATION_SPEED_OPTIONS"
					:key="speed.value"
					:color="animationSpeed === speed.value ? 'primary' : 'neutral'"
					:variant="animationSpeed === speed.value ? 'subtle' : 'outline'"
					:aria-label="`${speed.label} preview speed`"
					:data-testid="`animation-preview-speed-${speed.value}`"
					@click="() => { animationSpeed = speed.value }"
				>
					{{ speed.label }}
				</UButton>
			</UFieldGroup>
			<UFormField label="Loop" size="xs" class="flex items-center gap-2">
				<USwitch v-model="animationLoop" size="sm" data-testid="animation-preview-loop" />
			</UFormField>
			<UButton
				size="xs"
				icon="i-lucide-play"
				:disabled="previewGraphicId === null"
				data-testid="animation-preview-play"
				@click="playAnimation"
			>
				Play
			</UButton>
			<UButton
				size="xs"
				variant="outline"
				icon="i-lucide-square"
				:disabled="animationRun === 0"
				data-testid="animation-preview-stop"
				@click="stopAnimation"
			>
				Stop
			</UButton>
			<p v-if="previewGraphicId === null" class="text-xs text-muted" data-testid="animation-preview-hint">
				Select a Broadcast Graphic to preview its animation.
			</p>
		</div>

		<div class="transparent-checkerboard-backdrop overflow-auto rounded-md">
			<div
				class="relative mx-auto"
				:class="previewZoom === 'fit' ? 'w-full' : 'shrink-0'"
				:style="previewAspectStyle"
			>
				<iframe
					ref="previewFrame"
					:key="previewUrl"
					:src="previewUrl"
					class="absolute inset-0 size-full border-0"
					title="Graphics compositor preview"
					@load="pushPreviewState"
				/>
			</div>
		</div>
	</ScreenSettingsCard>
</template>
