<script setup lang="ts">
import type { FeatureMatchOverlayFrameAnimationConfig } from '~~/shared/animationEffects';
import type { MediaFit } from '~~/shared/types/graphicItem';
import type { FeatureMatchLayoutFrameConfig, FeatureMatchOverlayModeConfig, ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { parseFrameAnimationConfig } from '~~/shared/animationEffects';
import { DEFAULT_FRAME_ANIMATION, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';
import { MEDIA_FIT_OPTIONS } from '~/utils/mediaFields';
import FeatureMatchOverlayBorderSidesControl from './BorderSidesControl.vue';

/**
 * The Frame's own fields, each section ending with the Look of what it styles:
 * its fill, border and glow are the Theme's `frame-surface` Mode Token, its
 * effect `frame-animation-effect`, and the Theme may add media beneath its own
 * (#831). Each row writes a Screen Theme Override (ADR-0072).
 */
const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	screen: Screen;
	eventId: number;
	/** Frame mutation seam from the Feature Match Layout writer. */
	patchFrame: (updates: Partial<FeatureMatchLayoutFrameConfig>) => void;
}>();

/** A pre-rebuild config starts the editor over from the defaults. */
const animation = computed<FeatureMatchOverlayFrameAnimationConfig>(() =>
	parseFrameAnimationConfig(props.config.layout.frame.animation) ?? DEFAULT_FRAME_ANIMATION,
);

const mediaBackground = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(props.config.layout.frame.mediaBackground ?? {}),
}));

function updateFrame(updates: Partial<FeatureMatchLayoutFrameConfig>) {
	props.patchFrame(updates);
}

function updateAnimation(updates: Partial<FeatureMatchOverlayFrameAnimationConfig>) {
	updateFrame({
		animation: {
			...animation.value,
			...updates,
		},
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

const backgroundSummary = computed(() => {
	const frame = props.config.layout.frame;
	const parts = [`opacity ${frame.opacity}`];
	if (frame.backgroundImage)
		parts.push('image');
	return parts.join(' • ');
});
</script>

<template>
	<div class="min-w-0">
		<ScreenSettingsSection
			id="feature-match-overlay-background"
			density="row"
			title="Background"
			:summary="backgroundSummary"
		>
			<div class="space-y-3">
				<GraphicsOpacityField
					label="Opacity"
					:model-value="config.layout.frame.opacity"
					size="sm"
					data-testid="frame-opacity"
					@update:model-value="updateFrame({ opacity: Number($event ?? 0) })"
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
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="feature-match-overlay-video"
			density="row"
			title="Video"
			:summary="mediaBackground.enabled ? 'On' : 'Off'"
		>
			<div class="space-y-4">
				<ScreenMediaBackgroundFields
					:media="mediaBackground"
					:event-id="eventId"
					@update="updateMediaBackground"
				/>
				<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="frame-video" />
			</div>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="feature-match-overlay-animation"
			density="row"
			title="Animation"
			:summary="animation.enabled ? `opacity ${animation.opacity}` : 'Off'"
		>
			<div class="space-y-4">
				<ScreenSettingsToggle
					label="Animation"
					:model-value="animation.enabled"
					@update:model-value="updateAnimation({ enabled: $event })"
				/>

				<GraphicsOpacityField
					v-if="animation.enabled"
					label="Layer opacity"
					:model-value="animation.opacity"
					size="sm"
					data-testid="frame-animation-opacity"
					@update:model-value="updateAnimation({ opacity: Number($event) })"
				/>

				<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="frame-animation" />
			</div>
		</ScreenSettingsSection>

		<ScreenSettingsSection
			id="feature-match-overlay-surface"
			density="row"
			title="Surface"
			summary="Fill, border and glow"
		>
			<div class="space-y-4">
				<FeatureMatchOverlayBorderSidesControl
					label="Frame border sides"
					:sides="config.layout.frame"
					@update="updateFrame"
				/>
				<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="frame-surface" />
			</div>
		</ScreenSettingsSection>
	</div>
</template>
