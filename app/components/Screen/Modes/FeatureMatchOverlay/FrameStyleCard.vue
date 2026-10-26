<script setup lang="ts">
import type { AnimationEffectName, AnimationEffectSelection, FeatureMatchOverlayFrameAnimationConfig } from '~~/shared/animationEffects';
import type { MediaFit } from '~~/shared/types/graphicItem';
import type { FeatureMatchLayoutFrameConfig, FeatureMatchOverlayModeConfig, ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import {
	ANIMATION_EFFECT_CATALOGUE,
	featureMatchOverlayFrameAnimationConfigSchema,
	parseFrameAnimationConfig,
} from '~~/shared/animationEffects';
import { DEFAULT_FRAME_ANIMATION, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';
import { borderGlowFieldsValue, borderGlowStyleUpdates } from '~/modules/feature-match-overlay/borderGlow';
import { MEDIA_FIT_OPTIONS } from '~/utils/mediaFields';
import FeatureMatchOverlayBackgroundFields from './BackgroundFields.vue';
import FeatureMatchOverlayControlSection from './ControlSection.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	eventId: number;
	/** Frame mutation seam from the Feature Match Layout writer. */
	patchFrame: (updates: Partial<FeatureMatchLayoutFrameConfig>) => void;
}>();

/**
 * A pre-rebuild or unknown-effect config starts the editor over from the
 * defaults rather than carrying fields no effect declares into its next write.
 */
const animation = computed(() =>
	parseFrameAnimationConfig(props.config.layout.frame.animation)
	?? featureMatchOverlayFrameAnimationConfigSchema.parse(DEFAULT_FRAME_ANIMATION),
);

const animationSelection = computed<AnimationEffectSelection>(() => ({
	effect: animation.value.effect,
	params: animation.value.params,
} as AnimationEffectSelection));
const mediaBackground = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(props.config.layout.frame.mediaBackground ?? {}),
}));

function updateFrame(updates: Partial<FeatureMatchLayoutFrameConfig>) {
	props.patchFrame(updates);
}

function updateAnimation(updates: Partial<Pick<FeatureMatchOverlayFrameAnimationConfig, 'enabled' | 'opacity'>>) {
	updateFrame({
		animation: {
			...animation.value,
			...updates,
		},
	});
}

/** The shared fields own effect switching and param coercion; the Frame adds its own fields back. */
function applyAnimationSelection(selection: AnimationEffectSelection) {
	updateFrame({
		animation: {
			enabled: animation.value.enabled,
			opacity: animation.value.opacity,
			...selection,
		} as FeatureMatchOverlayFrameAnimationConfig,
	});
}

function updateMediaBackground(updates: Partial<ScreenMediaBackgroundConfig>) {
	updateFrame({
		mediaBackground: {
			...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
			...mediaBackground.value,
			...updates,
		},
	});
}

function updateFrameBackground(updates: { color?: string; gradient?: string; opacity?: number }) {
	const frameUpdates: Partial<FeatureMatchLayoutFrameConfig> = {};
	if ('color' in updates)
		frameUpdates.backgroundColor = updates.color ?? 'transparent';
	if ('gradient' in updates)
		frameUpdates.gradient = updates.gradient;
	if ('opacity' in updates)
		frameUpdates.opacity = updates.opacity ?? 0;
	updateFrame(frameUpdates);
}

function animationEffectLabel(effect: AnimationEffectName) {
	return ANIMATION_EFFECT_CATALOGUE[effect].label;
}

const backgroundSummary = computed(() => {
	const frame = props.config.layout.frame;
	const parts = [frame.backgroundColor || 'transparent'];
	if (frame.gradient)
		parts.push('gradient');
	if (frame.backgroundImage)
		parts.push('image');
	return parts.join(' • ');
});

const borderSummary = computed(() => {
	const frame = props.config.layout.frame;
	return frame.borderVisible
		? `${frame.borderWidth ?? 1}px border`
		: 'No border';
});

function animationSummary() {
	return `${animationEffectLabel(animation.value.effect)} • opacity ${animation.value.opacity}`;
}
</script>

<template>
	<div class="min-w-0">
		<FeatureMatchOverlayControlSection title="Background" :summary="backgroundSummary" default-open>
			<div class="space-y-3">
				<FeatureMatchOverlayBackgroundFields
					:color="config.layout.frame.backgroundColor"
					:gradient="config.layout.frame.gradient"
					:opacity="config.layout.frame.opacity"
					color-placeholder="#111111"
					allow-raw-color
					empty-color-value="transparent"
					@update="updateFrameBackground"
				/>
				<div class="grid gap-3 sm:grid-cols-2 sm:items-end">
					<div class="space-y-3 sm:col-span-2" data-testid="frame-image-source">
						<ScreenMediaSourceField
							:model-value="config.layout.frame.backgroundImage"
							:event-id="eventId"
							asset-kind="image"
							label="Frame image"
							@update:model-value="updateFrame({ backgroundImage: $event ?? undefined })"
						/>
					</div>
					<UFormField label="Image fit">
						<USelect
							:model-value="config.layout.frame.backgroundImageFit"
							:items="MEDIA_FIT_OPTIONS"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="updateFrame({ backgroundImageFit: $event as MediaFit })"
						/>
					</UFormField>
				</div>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection title="Video" :summary="mediaBackground.enabled ? 'On' : 'Off'">
			<ScreenMediaBackgroundFields
				:media="mediaBackground"
				:event-id="eventId"
				@update="updateMediaBackground"
			/>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection title="Animation" :summary="animation.enabled ? animationSummary() : 'Off'">
			<div class="space-y-4">
				<ScreenSettingsToggle
					label="Animation"
					:model-value="animation.enabled"
					@update:model-value="updateAnimation({ enabled: $event })"
				/>

				<template v-if="animation.enabled">
					<UFormField label="Layer opacity">
						<UIOpacityInput
							:model-value="animation.opacity"
							size="sm"
							class="w-full"
							@update:model-value="updateAnimation({ opacity: Number($event) })"
						/>
					</UFormField>

					<ScreenAnimationEffectFields
						:selection="animationSelection"
						@update:selection="applyAnimationSelection"
					/>
				</template>
			</div>
		</FeatureMatchOverlayControlSection>

		<FeatureMatchOverlayControlSection title="Border and glow" :summary="borderSummary">
			<GraphicsBorderGlowFields
				border-label="Frame border"
				v-bind="borderGlowFieldsValue(config.layout.frame)"
				per-side
				glow-gated-on-border
				@edit="updateFrame(borderGlowStyleUpdates($event))"
			/>
		</FeatureMatchOverlayControlSection>
	</div>
</template>
