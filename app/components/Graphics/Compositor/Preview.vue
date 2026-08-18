<script setup lang="ts">
import type { SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { BroadcastGraphicConfig, GraphicAnimationPhase } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsPreviewAnimationScope } from '~/modules/graphics/previewMessages';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { GRAPHIC_ANIMATION_PHASE_LABELS } from '~~/shared/modules/graphics';
import { canonicalSocialProfileUrl, SUPPORTED_SOCIAL_NETWORK_BY_KEY, SUPPORTED_SOCIAL_NETWORKS } from '~~/shared/socialProfiles';
import { GRAPHIC_ANIMATION_PHASE_VALUES } from '~~/shared/types/graphics';
import { screenOutputPath } from '~~/shared/utils/screenOutput';
import {
	GRAPHICS_PREVIEW_STATE_MESSAGE,
	isGraphicsPreviewReadyMessage,
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

type PreviewBackground = 'transparent' | 'black' | 'white' | 'green';
const PREVIEW_BACKGROUND_OPTIONS: Array<{ label: string; value: PreviewBackground }> = [
	{ label: 'Transparency', value: 'transparent' },
	{ label: 'Black', value: 'black' },
	{ label: 'White', value: 'white' },
	{ label: 'Green', value: 'green' },
];

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
const previewBackground = ref<PreviewBackground>('transparent');
const itemGuides = ref(true);
const safeAreaGuides = ref(false);
const previewFrame = ref<HTMLIFrameElement | null>(null);

const animationPhase = ref<GraphicAnimationPhase>('enter');
const animationScope = ref<GraphicsPreviewAnimationScope>('phase');
const animationSpeed = ref<number>(1);
const animationLoop = ref(false);
/** Zero means nothing is playing; every start bumps it. */
const animationRun = ref(0);

interface SocialProfileSample {
	network: SupportedSocialNetwork;
	handle: string;
}

/**
 * Editor-only samples, keyed independently for every projection. They travel only
 * in the preview iframe message and are never emitted as authored graphics.
 */
const socialProfileSamples = ref<Record<string, Record<string, SocialProfileSample>>>({});

watch(() => props.graphics, (graphics) => {
	const next: Record<string, Record<string, SocialProfileSample>> = {};
	for (const graphic of graphics) {
		const projections = graphic.socialProfileProjections ?? [];
		if (projections.length === 0)
			continue;
		next[graphic.id] = Object.fromEntries(projections.map(projection => [
			projection.key,
			socialProfileSamples.value[graphic.id]?.[projection.key] ?? { network: 'twitch', handle: 'example' },
		]));
	}
	socialProfileSamples.value = next;
}, { deep: true, immediate: true });

const socialProfileSampleRows = computed(() => props.graphics.flatMap(graphic =>
	(graphic.socialProfileProjections ?? []).map(projection => ({
		graphicId: graphic.id,
		projection,
	})),
));

const SOCIAL_PROFILE_NETWORK_OPTIONS = SUPPORTED_SOCIAL_NETWORKS.map(network => ({
	label: network.label,
	value: network.key,
}));

function socialProfileSample(graphicId: string, projectionKey: string): SocialProfileSample {
	return socialProfileSamples.value[graphicId]?.[projectionKey] ?? { network: 'twitch', handle: 'example' };
}

function updateSocialProfileSample(
	graphicId: string,
	projectionKey: string,
	patch: Partial<SocialProfileSample>,
) {
	const current = socialProfileSample(graphicId, projectionKey);
	socialProfileSamples.value = {
		...socialProfileSamples.value,
		[graphicId]: {
			...socialProfileSamples.value[graphicId],
			[projectionKey]: { ...current, ...patch },
		},
	};
}

const previewSocialProfileValues = computed(() => Object.fromEntries(
	Object.entries(socialProfileSamples.value).map(([graphicId, samples]) => [
		graphicId,
		Object.fromEntries(Object.entries(samples).map(([projectionKey, sample]) => [
			projectionKey,
			{
				network: sample.network,
				networkLabel: SUPPORTED_SOCIAL_NETWORK_BY_KEY[sample.network].label,
				handle: sample.handle,
				profileUrl: canonicalSocialProfileUrl(sample.network, sample.handle),
			},
		])),
	]),
));

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
	embed: 'preview',
	itemGuides: itemGuides.value,
	safeAreaGuides: safeAreaGuides.value,
}));

const previewAspectStyle = computed(() => (previewZoom.value === 'fit'
	? {
			aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`,
			width: `${46 * props.canvasWidth / props.canvasHeight}vh`,
			maxWidth: '100%',
		}
	: {
			width: `${props.canvasWidth * Number(previewZoom.value)}px`,
			height: `${props.canvasHeight * Number(previewZoom.value)}px`,
			maxWidth: 'none',
		}));
const previewBackgroundStyle = computed(() => {
	if (previewBackground.value === 'black')
		return { backgroundColor: '#000000' };
	if (previewBackground.value === 'white')
		return { backgroundColor: '#ffffff' };
	if (previewBackground.value === 'green')
		return { backgroundColor: '#00b140' };
	return undefined;
});

function pushPreviewState() {
	if (!import.meta.client || !previewFrame.value?.contentWindow)
		return;

	previewFrame.value.contentWindow.postMessage({
		type: GRAPHICS_PREVIEW_STATE_MESSAGE,
		state: {
			graphics: JSON.parse(JSON.stringify(props.graphics)),
			selectedTarget: { ...props.selectedTarget },
			socialProfileValues: previewSocialProfileValues.value,
			animation: animationPlan.value,
		},
	}, window.location.origin);
}

function handlePreviewMessage(message: MessageEvent) {
	const expected = {
		origin: window.location.origin,
		source: previewFrame.value?.contentWindow ?? null,
	};

	// The frame reporting that it can now be spoken to. The `@load` push below
	// happens before the frame's own app has mounted as often as after it, and a
	// push that lost that race left the preview holding the Screen's stored stack
	// with nothing to say it had missed anything (#234).
	if (isGraphicsPreviewReadyMessage(message, expected)) {
		pushPreviewState();
		return;
	}

	if (isGraphicsPreviewSelectMessage(message, expected))
		emit('selectTarget', message.data.target);
}

onMounted(() => {
	window.addEventListener('message', handlePreviewMessage);
});

onBeforeUnmount(() => {
	window.removeEventListener('message', handlePreviewMessage);
});

watch(
	() => [props.graphics, props.selectedTarget, previewSocialProfileValues.value, animationPlan.value] as const,
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
				<USelect
					v-model="previewBackground"
					:items="PREVIEW_BACKGROUND_OPTIONS"
					value-key="value"
					size="sm"
					class="w-32"
					aria-label="Preview background"
				/>
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

		<div
			v-if="socialProfileSampleRows.length > 0"
			class="mb-3 space-y-2 rounded-md border border-default/70 p-2"
			data-testid="social-profile-preview-samples"
		>
			<p class="text-xs font-semibold text-muted">
				Social Profile samples
			</p>
			<div
				v-for="row in socialProfileSampleRows"
				:key="`${row.graphicId}:${row.projection.key}`"
				class="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)]"
				:data-social-profile-sample="row.projection.key"
			>
				<UFormField :label="`${row.projection.label} network`" size="xs">
					<USelect
						:model-value="socialProfileSample(row.graphicId, row.projection.key).network"
						:items="SOCIAL_PROFILE_NETWORK_OPTIONS"
						value-key="value"
						data-testid="social-profile-sample-network"
						@update:model-value="updateSocialProfileSample(row.graphicId, row.projection.key, { network: $event as SupportedSocialNetwork })"
					/>
				</UFormField>
				<UFormField :label="`${row.projection.label} handle`" size="xs">
					<UInput
						:model-value="socialProfileSample(row.graphicId, row.projection.key).handle"
						data-testid="social-profile-sample-handle"
						@update:model-value="updateSocialProfileSample(row.graphicId, row.projection.key, { handle: String($event) })"
					/>
				</UFormField>
			</div>
			<p class="text-xs text-muted">
				Samples affect this preview only and are never saved.
			</p>
		</div>

		<div class="overflow-auto">
			<div
				class="relative mx-auto overflow-hidden"
				:class="[
					previewZoom === 'fit' ? '' : 'shrink-0',
					{ 'transparent-checkerboard-backdrop': previewBackground === 'transparent' },
				]"
				:style="[previewAspectStyle, previewBackgroundStyle]"
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
