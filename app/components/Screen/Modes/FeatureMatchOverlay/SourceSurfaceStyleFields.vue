<script setup lang="ts">
import type { FeatureMatchSourceSurfaceStyle } from '~~/shared/types/screenConfig';
import FeatureMatchOverlayBorderSidesControl from './BorderSidesControl.vue';

/**
 * The Source Item framing controls.
 *
 * Only what a Source Item paints: a background wash behind the video area, a
 * per-side border, per-corner radii, and a glow. The shared Graphic Surface Style
 * has no per-side border by design — a composed rule-preset Shape Graphic Item
 * replaces it there — but the Frame and its Source Items are host capability, and
 * that is what this edits.
 */

const props = defineProps<{ surfaceStyle?: FeatureMatchSourceSurfaceStyle }>();

const emit = defineEmits<{
	update: [updates: Partial<FeatureMatchSourceSurfaceStyle>];
}>();

const style = computed(() => props.surfaceStyle ?? {});

function update(updates: Partial<FeatureMatchSourceSurfaceStyle>) {
	emit('update', updates);
}
</script>

<template>
	<div class="space-y-3">
		<div class="grid gap-3 md:grid-cols-2">
			<UFormField label="Background">
				<UInput
					type="color"
					:model-value="style.backgroundColor ?? '#000000'"
					size="sm"
					class="w-full"
					@update:model-value="update({ backgroundColor: String($event) })"
				/>
			</UFormField>
			<UFormField label="Background opacity">
				<UInputNumber
					:model-value="style.backgroundOpacity ?? 0"
					:min="0"
					:max="1"
					:step="0.05"
					size="sm"
					class="w-full"
					@update:model-value="update({ backgroundOpacity: $event ?? 0 })"
				/>
			</UFormField>
		</div>

		<div class="grid gap-3 md:grid-cols-3 md:items-end">
			<ScreenSettingsToggle
				label="Border"
				:model-value="style.borderVisible ?? false"
				@update:model-value="update({ borderVisible: $event })"
			/>
			<UFormField label="Border colour">
				<UInput
					type="color"
					:model-value="style.borderColor ?? '#ffffff'"
					size="sm"
					class="w-full"
					@update:model-value="update({ borderColor: String($event) })"
				/>
			</UFormField>
			<UFormField label="Border width">
				<UInputNumber
					:model-value="style.borderWidth ?? 0"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="update({ borderWidth: $event ?? 0 })"
				/>
			</UFormField>
		</div>

		<FeatureMatchOverlayBorderSidesControl
			:border-top-visible="style.borderTopVisible"
			:border-right-visible="style.borderRightVisible"
			:border-bottom-visible="style.borderBottomVisible"
			:border-left-visible="style.borderLeftVisible"
			@update="(side, value) => update({ [side]: value })"
		/>

		<UFormField label="Corner radius">
			<UInputNumber
				:model-value="style.borderRadius ?? 0"
				:min="0"
				size="sm"
				class="w-full"
				@update:model-value="update({ borderRadius: $event ?? 0 })"
			/>
		</UFormField>

		<div class="grid gap-3 md:grid-cols-3">
			<UFormField label="Glow colour">
				<UInput
					type="color"
					:model-value="style.glowColor ?? '#ffffff'"
					size="sm"
					class="w-full"
					@update:model-value="update({ glowColor: String($event) })"
				/>
			</UFormField>
			<UFormField label="Glow size">
				<UInputNumber
					:model-value="style.glowSize ?? 0"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="update({ glowSize: $event ?? 0 })"
				/>
			</UFormField>
			<UFormField label="Glow opacity">
				<UInputNumber
					:model-value="style.glowOpacity ?? 0.75"
					:min="0"
					:max="1"
					:step="0.05"
					size="sm"
					class="w-full"
					@update:model-value="update({ glowOpacity: $event ?? 0 })"
				/>
			</UFormField>
		</div>
	</div>
</template>
