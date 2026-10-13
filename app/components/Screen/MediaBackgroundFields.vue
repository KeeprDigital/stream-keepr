<script setup lang="ts">
import type { ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import type { MediaFieldsPatch } from '~/utils/mediaFields';
import { DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';
import { resolveMediaFieldsPatch } from '~/utils/mediaFields';

/** The Feature Match Overlay Frame's video: its switch and URL, then the shared media fields. */
const props = defineProps<{
	media?: ScreenMediaBackgroundConfig;
}>();

const emit = defineEmits<{
	update: [updates: Partial<ScreenMediaBackgroundConfig>];
}>();

const media = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(props.media ?? {}),
}));

function updateMedia(patch: MediaFieldsPatch) {
	emit('update', resolveMediaFieldsPatch(patch));
}
</script>

<template>
	<div class="space-y-3">
		<ScreenSettingsToggle
			label="Video Background"
			:model-value="media.enabled"
			@update:model-value="emit('update', { enabled: $event })"
		/>

		<template v-if="media.enabled">
			<UFormField label="Video URL">
				<UInput
					:model-value="media.url"
					placeholder="https://.../background.mp4"
					size="sm"
					class="w-full"
					@update:model-value="emit('update', { url: String($event ?? '') })"
				/>
			</UFormField>

			<GraphicsMediaFields
				:media="media"
				opacity
				playback
				@update="updateMedia"
			/>
		</template>
	</div>
</template>
