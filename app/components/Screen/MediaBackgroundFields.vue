<script setup lang="ts">
import type { ScreenMediaBackgroundConfig, ScreenMediaBackgroundFit } from '~~/shared/types/screenConfig';
import { DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';

const props = defineProps<{
	media?: ScreenMediaBackgroundConfig;
}>();

const emit = defineEmits<{
	update: [updates: Partial<ScreenMediaBackgroundConfig>];
}>();

const FIT_OPTIONS: { label: string; value: ScreenMediaBackgroundFit }[] = [
	{ label: 'Cover', value: 'cover' },
	{ label: 'Contain', value: 'contain' },
	{ label: 'Fill', value: 'fill' },
];

const media = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(props.media ?? {}),
}));
</script>

<template>
	<div class="space-y-3">
		<ScreenSettingsToggle
			label="Video Background"
			:model-value="media.enabled"
			@update:model-value="emit('update', { enabled: $event })"
		/>

		<div v-if="media.enabled" class="grid gap-3 md:grid-cols-2">
			<UFormField label="Video URL" class="md:col-span-2">
				<UInput
					:model-value="media.url"
					placeholder="https://.../background.mp4"
					size="sm"
					class="w-full"
					@update:model-value="emit('update', { url: String($event ?? '') })"
				/>
			</UFormField>

			<UFormField label="Fit">
				<USelect
					:model-value="media.fit"
					:items="FIT_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="emit('update', { fit: $event as ScreenMediaBackgroundFit })"
				/>
			</UFormField>

			<UFormField label="Opacity">
				<UInputNumber
					:model-value="media.opacity"
					:step="0.05"
					:min="0"
					:max="1"
					size="sm"
					class="w-full"
					@update:model-value="emit('update', { opacity: Number($event) })"
				/>
			</UFormField>

			<UFormField label="Playback Speed">
				<UInputNumber
					:model-value="media.playbackRate"
					:step="0.05"
					:min="0.1"
					:max="4"
					size="sm"
					class="w-full"
					@update:model-value="emit('update', { playbackRate: Number($event) })"
				/>
			</UFormField>

			<ScreenSettingsToggle
				label="Loop"
				:model-value="media.loop"
				@update:model-value="emit('update', { loop: $event })"
			/>
		</div>
	</div>
</template>
