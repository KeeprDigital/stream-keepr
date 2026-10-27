<script setup lang="ts">
import type { FeatureMatchOverlayGlowPosition, FeatureMatchSourceFramingStyle } from '~~/shared/types/screenConfig';
import FeatureMatchOverlayBorderRadiusControl from './BorderRadiusControl.vue';
import FeatureMatchOverlayBorderSidesControl from './BorderSidesControl.vue';

/**
 * The Source Item framing controls: its shape only. Per-corner radii, which
 * sides of its border show, and which side of the border its glow falls on.
 * Its fill, border and glow are the Theme's `source-surface` Mode Token,
 * shared by every Source Item (#831).
 */

const props = defineProps<{ framingStyle?: FeatureMatchSourceFramingStyle }>();

const emit = defineEmits<{
	update: [updates: Partial<FeatureMatchSourceFramingStyle>];
}>();

const style = computed(() => props.framingStyle ?? {});

const GLOW_POSITION_OPTIONS = [
	{ label: 'Both', value: 'both' },
	{ label: 'Inside', value: 'inside' },
	{ label: 'Outside', value: 'outside' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayGlowPosition }>;

function update(updates: Partial<FeatureMatchSourceFramingStyle>) {
	emit('update', updates);
}
</script>

<template>
	<div class="space-y-3">
		<p class="text-xs text-muted" data-testid="source-framing-theme-note">
			Fill, border and glow follow the Theme's Source Item surface.
		</p>

		<FeatureMatchOverlayBorderRadiusControl
			:border-radius="style.borderRadius"
			:border-radius-top-left="style.borderRadiusTopLeft"
			:border-radius-top-right="style.borderRadiusTopRight"
			:border-radius-bottom-right="style.borderRadiusBottomRight"
			:border-radius-bottom-left="style.borderRadiusBottomLeft"
			@update="(field, value) => update({ [field]: value })"
		/>

		<FeatureMatchOverlayBorderSidesControl
			label="Border sides"
			:sides="style"
			@update="update"
		/>

		<UFormField label="Glow position" size="sm">
			<USelect
				:model-value="style.glowPosition ?? 'both'"
				:items="GLOW_POSITION_OPTIONS"
				value-key="value"
				size="sm"
				class="w-full"
				aria-label="Glow position"
				@update:model-value="update({ glowPosition: $event as FeatureMatchOverlayGlowPosition })"
			/>
		</UFormField>
	</div>
</template>
