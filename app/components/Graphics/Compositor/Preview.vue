<script setup lang="ts">
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { BroadcastGraphicConfig, GraphicRect } from '~~/shared/types/graphics';
import type { EditorSelectionFrame } from '~/modules/graphics/editor/layerFrame';
import type { GraphicsPreviewAnimationPlan } from '~/modules/graphics/previewMessages';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { Screen } from '~/types';
import { canonicalSocialProfileUrl, SUPPORTED_SOCIAL_NETWORK_BY_KEY, SUPPORTED_SOCIAL_NETWORKS } from '~~/shared/socialProfiles';
import { GRAPHICS_PREVIEW_STATE_MESSAGE, GRAPHICS_PREVIEW_THEME_MESSAGE } from '~/modules/graphics/previewMessages';
import { graphicsSelectionGraphicId } from '~/modules/graphics/selection';

/**
 * The Broadcast Graphics editor preview: the shared editor preview shell
 * (`GraphicsEditorPreview`: frame, guides, zoom, canvas handles, Graphic
 * Animation Preview), plus this host's preview background and Social Profile
 * samples.
 *
 * The preview is a real Screen Output frame, asked explicitly for its guides.
 * A live Screen Output is never asked, so no guide can reach one. Several
 * selected layers reach the frame as their Broadcast Graphic, which it marks;
 * the canvas handles outline each of them (#1101).
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
 * The controls are the shared `GraphicsAnimationPreviewControls`, which describe
 * a run as a plan; there is no playhead and no scrubbing.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
	/**
	 * The stored values of a Theme to preview bound Graphic Items under, null to
	 * follow the Screen's Event's Theme, or absent to tell the frame nothing yet.
	 */
	previewThemeValues?: StoredThemeTokens | null;
	/** Where the selected layers sit on the canvas, when this session may move them. */
	selectionFrame?: EditorSelectionFrame | null;
	selectionLabel?: string;
	/** Where each selected locked layer sits on the canvas, badged as locked. */
	lockedBoxes?: readonly GraphicRect[];
}>();

const emit = defineEmits<{
	/** `toggle` is a ⌘- or Ctrl-click: add the item to the selection, or take it out. */
	selectTarget: [target: GraphicsSelectionTarget, toggle: boolean];
	/** The selection moved or resized on the canvas; one `gesture` per drag. */
	manipulate: [rect: GraphicRect, gesture: number];
	/** Each frame of a canvas rotate drag, as the selected Graphic Item's new Graphic Rotation. */
	rotate: [rotation: number, gesture: number];
	/** A canvas drag began, and ended: the frames between are one edit. */
	gestureStart: [];
	gestureEnd: [];
}>();

type PreviewBackground = 'transparent' | 'black' | 'white' | 'green';
const PREVIEW_BACKGROUND_OPTIONS: Array<{ label: string; value: PreviewBackground; color?: string }> = [
	{ label: 'Transparency', value: 'transparent' },
	{ label: 'Black', value: 'black', color: '#000000' },
	{ label: 'White', value: 'white', color: '#ffffff' },
	{ label: 'Green', value: 'green', color: '#00b140' },
];

const previewBackground = ref<PreviewBackground>('transparent');
const previewBackgroundColor = computed(() =>
	PREVIEW_BACKGROUND_OPTIONS.find(option => option.value === previewBackground.value)?.color);

/** The run the shared controls describe; null composes at the Graphic Resting State. */
const animationPlan = ref<GraphicsPreviewAnimationPlan | null>(null);

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
			[projectionKey]: {
				...current,
				...patch,
			},
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

/** A run plays a whole Broadcast Graphic. */
const animationTarget = computed(() => previewGraphicId.value === null
	? null
	: { graphicId: previewGraphicId.value });

/**
 * What the frame is told: one preview state — the working stack, what is
 * selected, the Social Profile samples and the run in play — and the Theme
 * previewed under, once there is one to name.
 */
const previewMessages = computed(() => [
	{
		type: GRAPHICS_PREVIEW_STATE_MESSAGE,
		state: {
			graphics: props.graphics,
			selectedTarget: props.selectedTarget,
			socialProfileValues: previewSocialProfileValues.value,
			animation: animationPlan.value,
		},
	},
	...(props.previewThemeValues === undefined
		? []
		: [
				{ type: GRAPHICS_PREVIEW_THEME_MESSAGE, tokens: props.previewThemeValues },
			]),
]);
</script>

<template>
	<GraphicsEditorPreview
		v-model:animation-plan="animationPlan"
		:event-id="eventId"
		:screen-slug="screen.slug"
		:canvas-width="canvasWidth"
		:canvas-height="canvasHeight"
		title="Graphics compositor preview"
		:messages="previewMessages"
		:animation-target="animationTarget"
		animation-hint="Select a Broadcast Graphic to preview its animation."
		:selection-frame="selectionFrame"
		:selection-label="selectionLabel"
		:locked-boxes="lockedBoxes"
		:background="previewBackgroundColor"
		@select="(target, toggle) => emit('selectTarget', target, toggle)"
		@manipulate="(rect, gesture) => emit('manipulate', rect, gesture)"
		@rotate="(rotation, gesture) => emit('rotate', rotation, gesture)"
		@gesture-start="emit('gestureStart')"
		@gesture-end="emit('gestureEnd')"
	>
		<template #controls>
			<USelect
				v-model="previewBackground"
				:items="PREVIEW_BACKGROUND_OPTIONS"
				value-key="value"
				size="sm"
				class="w-32"
				aria-label="Preview background"
			/>
		</template>

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
	</GraphicsEditorPreview>
</template>
