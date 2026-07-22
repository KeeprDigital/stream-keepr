<script setup lang="ts">
import type { FeatureMatchLayoutFrameConfig, FeatureMatchOverlayFrameAnimationConfig, FeatureMatchOverlayFrameAnimationEffect, FeatureMatchOverlayModeConfig, ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import { DEFAULT_FRAME_ANIMATION, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';
import FeatureMatchOverlayBackgroundFields from './BackgroundFields.vue';
import FeatureMatchOverlayBorderSidesControl from './BorderSidesControl.vue';
import FeatureMatchOverlayControlSection from './ControlSection.vue';

const props = defineProps<{
	config: FeatureMatchOverlayModeConfig;
	/** Frame mutation seam from the Feature Match Layout writer. */
	patchFrame: (updates: Partial<FeatureMatchLayoutFrameConfig>) => void;
}>();

const BACKGROUND_IMAGE_FIT_OPTIONS = [
	{ label: 'Cover', value: 'cover' },
	{ label: 'Contain', value: 'contain' },
	{ label: 'Fill', value: 'fill' },
] satisfies Array<{ label: string; value: NonNullable<FeatureMatchLayoutFrameConfig['backgroundImageFit']> }>;
const ANIMATION_EFFECT_OPTIONS: { label: string; value: FeatureMatchOverlayFrameAnimationEffect }[] = [
	{ label: 'Cells', value: 'cells' },
	{ label: 'Dots', value: 'dots' },
	{ label: 'Fog', value: 'fog' },
	{ label: 'Globe', value: 'globe' },
	{ label: 'Halo', value: 'halo' },
	{ label: 'Net', value: 'net' },
	{ label: 'Rings', value: 'rings' },
	{ label: 'Ripple', value: 'ripple' },
	{ label: 'Waves', value: 'waves' },
];
const ANIMATION_MOVEMENT_OPTIONS = [
	{ label: 'Smooth orbit', value: 'orbit' },
	{ label: 'Random wander', value: 'random' },
];

const DEFAULT_ANIMATION: FeatureMatchOverlayFrameAnimationConfig = {
	...DEFAULT_FRAME_ANIMATION,
	color1: '#008c8c',
	amplitudeFactor: 1,
	ringFactor: 1,
	rotationFactor: 1,
	xOffset: 0,
	yOffset: 0,
};

const animation = computed(() => ({ ...DEFAULT_ANIMATION, ...(props.config.layout.frame.animation ?? {}) }));
const mediaBackground = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(props.config.layout.frame.mediaBackground ?? {}),
}));

function updateFrame(updates: Partial<FeatureMatchLayoutFrameConfig>) {
	props.patchFrame(updates);
}

function updateFrameImageUrl(value: string | number) {
	updateFrame({ backgroundImageUrl: String(value).trim() || undefined });
}

function updateAnimation(updates: Partial<FeatureMatchOverlayFrameAnimationConfig>) {
	updateFrame({ animation: { ...animation.value, ...updates } });
}

function updateMediaBackground(updates: Partial<ScreenMediaBackgroundConfig>) {
	updateFrame({ mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG, ...mediaBackground.value, ...updates } });
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

function borderSideValue(side: 'borderTopVisible' | 'borderRightVisible' | 'borderBottomVisible' | 'borderLeftVisible') {
	return props.config.layout.frame[side] ?? true;
}

function animationEffectLabel(effect: FeatureMatchOverlayFrameAnimationEffect) {
	return ANIMATION_EFFECT_OPTIONS.find(option => option.value === effect)?.label ?? effect;
}

function animationSummary() {
	return `${animationEffectLabel(animation.value.effect)} • opacity ${animation.value.opacity}`;
}
</script>

<template>
	<div class="space-y-3">
		<div class="max-h-[58vh] divide-y divide-default/60 overflow-y-auto pr-2">
			<section class="py-4 first:pt-0 last:pb-0">
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
						<UFormField label="Image URL" class="sm:col-span-2">
							<UInput
								:model-value="config.layout.frame.backgroundImageUrl"
								placeholder="https://…"
								size="sm"
								class="w-full"
								@update:model-value="updateFrameImageUrl"
							/>
						</UFormField>
						<UFormField label="Image fit">
							<USelect
								:model-value="config.layout.frame.backgroundImageFit"
								:items="BACKGROUND_IMAGE_FIT_OPTIONS"
								value-key="value"
								size="sm"
								class="w-full"
								@update:model-value="updateFrame({ backgroundImageFit: $event as 'cover' | 'contain' | 'fill' })"
							/>
						</UFormField>
					</div>
				</div>
			</section>

			<section class="py-4 first:pt-0 last:pb-0">
				<ScreenMediaBackgroundFields
					:media="mediaBackground"
					@update="updateMediaBackground"
				/>
			</section>

			<section class="space-y-4 py-4 first:pt-0 last:pb-0">
				<ScreenSettingsToggle
					label="Animation"
					:model-value="animation.enabled"
					@update:model-value="updateAnimation({ enabled: $event })"
				/>

				<div v-if="animation.enabled" class="grid gap-3 md:grid-cols-2">
					<UFormField label="Effect">
						<USelect
							:model-value="animation.effect"
							:items="ANIMATION_EFFECT_OPTIONS"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="updateAnimation({ effect: $event as FeatureMatchOverlayFrameAnimationEffect })"
						/>
					</UFormField>
					<UFormField label="Layer opacity">
						<UInputNumber
							:model-value="animation.opacity"
							:step="0.05"
							:min="0"
							:max="1"
							size="sm"
							class="w-full"
							@update:model-value="updateAnimation({ opacity: Number($event) })"
						/>
					</UFormField>
				</div>

				<FeatureMatchOverlayControlSection
					v-if="animation.enabled"
					title="Effect tuning"
					:badge="animationEffectLabel(animation.effect)"
					:summary="animationSummary()"
				>
					<div v-if="animation.effect === 'fog'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Highlight color">
							<UIColorPicker :model-value="animation.highlightColor" placeholder="#f59e0b" @update:model-value="updateAnimation({ highlightColor: $event || DEFAULT_ANIMATION.highlightColor })" />
						</UFormField>
						<UFormField label="Midtone color">
							<UIColorPicker :model-value="animation.midtoneColor" placeholder="#7c3aed" @update:model-value="updateAnimation({ midtoneColor: $event || DEFAULT_ANIMATION.midtoneColor })" />
						</UFormField>
						<UFormField label="Lowlight color">
							<UIColorPicker :model-value="animation.lowlightColor" placeholder="#06b6d4" @update:model-value="updateAnimation({ lowlightColor: $event || DEFAULT_ANIMATION.lowlightColor })" />
						</UFormField>
						<UFormField label="Base color">
							<UIColorPicker :model-value="animation.baseColor" placeholder="#111111" @update:model-value="updateAnimation({ baseColor: $event || DEFAULT_ANIMATION.baseColor })" />
						</UFormField>
						<UFormField label="Softness">
							<UInputNumber
								:model-value="animation.blurFactor"
								:step="0.05"
								:min="0.1"
								:max="0.95"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ blurFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Speed">
							<UInputNumber
								:model-value="animation.speed"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ speed: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Zoom">
							<UInputNumber
								:model-value="animation.zoom"
								:step="0.1"
								:min="0.5"
								:max="3"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ zoom: Number($event) })"
							/>
						</UFormField>
					</div>

					<div v-else-if="animation.effect === 'cells'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Primary color">
							<UIColorPicker :model-value="animation.color1" placeholder="#008c8c" @update:model-value="updateAnimation({ color1: $event || DEFAULT_ANIMATION.color1 })" />
						</UFormField>
						<UFormField label="Secondary color">
							<UIColorPicker :model-value="animation.color2" placeholder="#06b6d4" @update:model-value="updateAnimation({ color2: $event || DEFAULT_ANIMATION.color2 })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
						<UFormField label="Intensity">
							<UInputNumber
								:model-value="animation.amplitudeFactor"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ amplitudeFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Ring scale">
							<UInputNumber
								:model-value="animation.ringFactor"
								:step="0.1"
								:min="0"
								:max="8"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ ringFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Rotation">
							<UInputNumber
								:model-value="animation.rotationFactor"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ rotationFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Cell size">
							<UInputNumber
								:model-value="animation.size"
								:step="0.1"
								:min="0.2"
								:max="5"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ size: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Speed">
							<UInputNumber
								:model-value="animation.speed"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ speed: Number($event) })"
							/>
						</UFormField>
					</div>

					<div v-else-if="animation.effect === 'globe'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Primary color">
							<UIColorPicker :model-value="animation.color" placeholder="#7c3aed" @update:model-value="updateAnimation({ color: $event || DEFAULT_ANIMATION.color })" />
						</UFormField>
						<UFormField label="Secondary color">
							<UIColorPicker :model-value="animation.color2" placeholder="#06b6d4" @update:model-value="updateAnimation({ color2: $event || DEFAULT_ANIMATION.color2 })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
						<UFormField label="Point size">
							<UInputNumber
								:model-value="animation.size"
								:step="0.1"
								:min="0.2"
								:max="5"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ size: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Point count">
							<UInputNumber
								:model-value="animation.points"
								:step="1"
								:min="2"
								:max="30"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ points: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Connection distance">
							<UInputNumber
								:model-value="animation.maxDistance"
								:step="1"
								:min="1"
								:max="80"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ maxDistance: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Spacing">
							<UInputNumber
								:model-value="animation.spacing"
								:step="1"
								:min="2"
								:max="80"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ spacing: Number($event) })"
							/>
						</UFormField>
						<ScreenSettingsToggle
							label="Point markers"
							description="Render point markers around the globe."
							:model-value="animation.showDots"
							@update:model-value="updateAnimation({ showDots: $event })"
						/>
					</div>

					<div v-else-if="animation.effect === 'halo'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Base color">
							<UIColorPicker :model-value="animation.baseColor" placeholder="#111111" @update:model-value="updateAnimation({ baseColor: $event || DEFAULT_ANIMATION.baseColor })" />
						</UFormField>
						<UFormField label="Accent color">
							<UIColorPicker :model-value="animation.color2" placeholder="#06b6d4" @update:model-value="updateAnimation({ color2: $event || DEFAULT_ANIMATION.color2 })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
						<UFormField label="Intensity">
							<UInputNumber
								:model-value="animation.amplitudeFactor"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ amplitudeFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Ring scale">
							<UInputNumber
								:model-value="animation.ringFactor"
								:step="0.1"
								:min="0"
								:max="8"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ ringFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Rotation">
							<UInputNumber
								:model-value="animation.rotationFactor"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ rotationFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Horizontal offset">
							<UInputNumber
								:model-value="animation.xOffset"
								:step="0.05"
								:min="-1"
								:max="1"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ xOffset: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Vertical offset">
							<UInputNumber
								:model-value="animation.yOffset"
								:step="0.05"
								:min="-1"
								:max="1"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ yOffset: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Size">
							<UInputNumber
								:model-value="animation.size"
								:step="0.1"
								:min="0.2"
								:max="5"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ size: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Speed">
							<UInputNumber
								:model-value="animation.speed"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ speed: Number($event) })"
							/>
						</UFormField>
					</div>

					<div v-else-if="animation.effect === 'rings'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Ring color">
							<UIColorPicker :model-value="animation.color" placeholder="#7c3aed" @update:model-value="updateAnimation({ color: $event || DEFAULT_ANIMATION.color })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
					</div>

					<div v-else-if="animation.effect === 'ripple'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Primary color">
							<UIColorPicker :model-value="animation.color1" placeholder="#008c8c" @update:model-value="updateAnimation({ color1: $event || DEFAULT_ANIMATION.color1 })" />
						</UFormField>
						<UFormField label="Secondary color">
							<UIColorPicker :model-value="animation.color2" placeholder="#06b6d4" @update:model-value="updateAnimation({ color2: $event || DEFAULT_ANIMATION.color2 })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
						<UFormField label="Intensity">
							<UInputNumber
								:model-value="animation.amplitudeFactor"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ amplitudeFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Ripple scale">
							<UInputNumber
								:model-value="animation.ringFactor"
								:step="0.1"
								:min="0"
								:max="12"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ ringFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Rotation">
							<UInputNumber
								:model-value="animation.rotationFactor"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ rotationFactor: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Speed">
							<UInputNumber
								:model-value="animation.speed"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ speed: Number($event) })"
							/>
						</UFormField>
					</div>

					<div v-else-if="animation.effect === 'waves'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Wave color">
							<UIColorPicker :model-value="animation.color" placeholder="#7c3aed" @update:model-value="updateAnimation({ color: $event || DEFAULT_ANIMATION.color })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
						<UFormField label="Shine">
							<UInputNumber
								:model-value="animation.shininess"
								:step="1"
								:min="0"
								:max="100"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ shininess: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Wave height">
							<UInputNumber
								:model-value="animation.waveHeight"
								:step="1"
								:min="0"
								:max="50"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ waveHeight: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Wave speed">
							<UInputNumber
								:model-value="animation.waveSpeed"
								:step="0.1"
								:min="0"
								:max="4"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ waveSpeed: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Zoom">
							<UInputNumber
								:model-value="animation.zoom"
								:step="0.1"
								:min="0.5"
								:max="3"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ zoom: Number($event) })"
							/>
						</UFormField>
					</div>

					<div v-else-if="animation.effect === 'net'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Line color">
							<UIColorPicker :model-value="animation.color" placeholder="#7c3aed" @update:model-value="updateAnimation({ color: $event || DEFAULT_ANIMATION.color })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
						<UFormField label="Point count">
							<UInputNumber
								:model-value="animation.points"
								:step="1"
								:min="2"
								:max="30"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ points: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Connection distance">
							<UInputNumber
								:model-value="animation.maxDistance"
								:step="1"
								:min="1"
								:max="80"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ maxDistance: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Spacing">
							<UInputNumber
								:model-value="animation.spacing"
								:step="1"
								:min="2"
								:max="80"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ spacing: Number($event) })"
							/>
						</UFormField>
						<ScreenSettingsToggle
							label="Point markers"
							description="Render point markers at net intersections."
							:model-value="animation.showDots"
							@update:model-value="updateAnimation({ showDots: $event })"
						/>
					</div>

					<div v-else-if="animation.effect === 'dots'" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Dot color">
							<UIColorPicker :model-value="animation.color" placeholder="#7c3aed" @update:model-value="updateAnimation({ color: $event || DEFAULT_ANIMATION.color })" />
						</UFormField>
						<UFormField label="Accent color">
							<UIColorPicker :model-value="animation.color2" placeholder="#06b6d4" @update:model-value="updateAnimation({ color2: $event || DEFAULT_ANIMATION.color2 })" />
						</UFormField>
						<UFormField label="Background color">
							<UIColorPicker :model-value="animation.backgroundColor" placeholder="#111111" @update:model-value="updateAnimation({ backgroundColor: $event || DEFAULT_ANIMATION.backgroundColor })" />
						</UFormField>
						<UFormField label="Dot size">
							<UInputNumber
								:model-value="animation.size"
								:step="0.5"
								:min="0.5"
								:max="20"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ size: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Spacing">
							<UInputNumber
								:model-value="animation.spacing"
								:step="1"
								:min="5"
								:max="100"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ spacing: Number($event) })"
							/>
						</UFormField>
						<ScreenSettingsToggle
							label="Connecting lines"
							description="Render connecting line segments between dots."
							:model-value="animation.showLines"
							@update:model-value="updateAnimation({ showLines: $event })"
						/>
					</div>
				</FeatureMatchOverlayControlSection>

				<ScreenSettingsToggle
					v-if="animation.enabled"
					label="Movement"
					:model-value="animation.mouseDriftEnabled"
					@update:model-value="updateAnimation({ mouseDriftEnabled: $event })"
				>
					<div v-if="animation.mouseDriftEnabled" class="grid gap-3 md:grid-cols-3">
						<UFormField label="Movement style">
							<USelect
								:model-value="animation.mouseDriftMode"
								:items="ANIMATION_MOVEMENT_OPTIONS"
								value-key="value"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ mouseDriftMode: $event as 'orbit' | 'random' })"
							/>
						</UFormField>
						<UFormField label="Movement speed">
							<UInputNumber
								:model-value="animation.mouseDriftSeconds"
								:step="1"
								:min="2"
								:max="120"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ mouseDriftSeconds: Number($event) })"
							/>
						</UFormField>
						<UFormField label="Movement range">
							<UInputNumber
								:model-value="animation.mouseDriftRadius"
								:step="0.02"
								:min="0"
								:max="0.5"
								size="sm"
								class="w-full"
								@update:model-value="updateAnimation({ mouseDriftRadius: Number($event) })"
							/>
						</UFormField>
					</div>
				</ScreenSettingsToggle>
			</section>

			<section class="space-y-3 py-4 first:pt-0 last:pb-0">
				<ScreenSettingsToggle
					label="Frame border"
					:model-value="config.layout.frame.borderVisible"
					@update:model-value="updateFrame({ borderVisible: $event })"
				/>
				<div v-if="config.layout.frame.borderVisible" class="grid items-end gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)]">
					<UFormField label="Color">
						<UIColorPicker
							:model-value="config.layout.frame.borderColor"
							placeholder="#0077a3"
							@update:model-value="updateFrame({ borderColor: $event || undefined })"
						/>
					</UFormField>
					<FeatureMatchOverlayBorderSidesControl
						:border-top-visible="borderSideValue('borderTopVisible')"
						:border-right-visible="borderSideValue('borderRightVisible')"
						:border-bottom-visible="borderSideValue('borderBottomVisible')"
						:border-left-visible="borderSideValue('borderLeftVisible')"
						@update="(side, value) => updateFrame({ [side]: value })"
					/>
					<UFormField label="Width">
						<UInputNumber
							:model-value="config.layout.frame.borderWidth"
							size="sm"
							class="w-full"
							@update:model-value="updateFrame({ borderWidth: Number($event) })"
						/>
					</UFormField>
				</div>
				<div v-if="config.layout.frame.borderVisible" class="grid gap-3 md:grid-cols-3">
					<UFormField label="Glow color">
						<UIColorPicker
							:model-value="config.layout.frame.glowColor"
							placeholder="#ffffff"
							@update:model-value="updateFrame({ glowColor: $event || undefined })"
						/>
					</UFormField>
					<UFormField label="Glow size">
						<UInputNumber
							:model-value="config.layout.frame.glowSize ?? 0"
							:min="0"
							:max="200"
							size="sm"
							class="w-full"
							@update:model-value="updateFrame({ glowSize: Number($event) })"
						/>
					</UFormField>
					<UFormField label="Glow opacity">
						<UInputNumber
							:model-value="config.layout.frame.glowOpacity ?? 0.75"
							:step="0.05"
							:min="0"
							:max="1"
							size="sm"
							class="w-full"
							@update:model-value="updateFrame({ glowOpacity: Number($event) })"
						/>
					</UFormField>
				</div>
			</section>
		</div>
	</div>
</template>
