<script setup lang="ts">
import type { FeatureMatchSourceFramingStyle } from '~~/shared/types/screenConfig';
import { borderGlowFieldsValue, borderGlowStyleUpdates } from '~/modules/feature-match-overlay/borderGlow';
import { SOURCE_ITEM_UNSET_BORDER_COLOUR } from '~/modules/feature-match-overlay/renderModel';
import FeatureMatchOverlayBackgroundFields from './BackgroundFields.vue';
import FeatureMatchOverlayBorderRadiusControl from './BorderRadiusControl.vue';

/**
 * The Source Item framing controls.
 *
 * Only what a Source Item paints: a background wash behind the video area,
 * per-corner radii, and, through the shared border and glow fields, a per-side
 * border and a glow. Its pickers offer hex colours; the renderer keeps the
 * opacity of any stored colour (`~/modules/screen/outputPaint.ts`).
 *
 * The shared Graphic Surface Style has no per-side border by design — a composed
 * rule-preset Shape Graphic Item replaces it there — but the Frame and its Source
 * Items are host capability, and that is what this edits.
 *
 * The background block is the Frame's own, so both host-owned surfaces offer the
 * same base colour, gradient overlay, and opacity.
 */

const props = defineProps<{ framingStyle?: FeatureMatchSourceFramingStyle }>();

const emit = defineEmits<{
	update: [updates: Partial<FeatureMatchSourceFramingStyle>];
}>();

const style = computed(() => props.framingStyle ?? {});

function update(updates: Partial<FeatureMatchSourceFramingStyle>) {
	emit('update', updates);
}

function updateBackground(updates: { color?: string; gradient?: string; opacity?: number }) {
	const styleUpdates: Partial<FeatureMatchSourceFramingStyle> = {};
	if ('color' in updates)
		styleUpdates.backgroundColor = updates.color;
	if ('gradient' in updates)
		styleUpdates.backgroundGradient = updates.gradient;
	if ('opacity' in updates)
		styleUpdates.backgroundOpacity = updates.opacity ?? 0;
	update(styleUpdates);
}
</script>

<template>
	<div class="space-y-3">
		<FeatureMatchOverlayBackgroundFields
			:color="style.backgroundColor"
			:gradient="style.backgroundGradient"
			:opacity="style.backgroundOpacity"
			color-label="Background"
			opacity-label="Background opacity"
			@update="updateBackground"
		/>

		<FeatureMatchOverlayBorderRadiusControl
			:border-radius="style.borderRadius"
			:border-radius-top-left="style.borderRadiusTopLeft"
			:border-radius-top-right="style.borderRadiusTopRight"
			:border-radius-bottom-right="style.borderRadiusBottomRight"
			:border-radius-bottom-left="style.borderRadiusBottomLeft"
			@update="(field, value) => update({ [field]: value })"
		/>

		<GraphicsBorderGlowFields
			border-label="Border"
			v-bind="borderGlowFieldsValue(style, SOURCE_ITEM_UNSET_BORDER_COLOUR)"
			per-side
			glow-position
			glow-gated-on-border
			hex-only
			@edit="update(borderGlowStyleUpdates($event))"
		/>
	</div>
</template>
