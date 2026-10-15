<script setup lang="ts">
import type { ScreenMediaBackgroundConfig, ScreenMediaSource } from '~~/shared/types/screenConfig';
import type { MediaFieldsPatch } from '~/utils/mediaFields';
import { DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';
import { resolveMediaFieldsPatch } from '~/utils/mediaFields';

/** The Feature Match Overlay Frame's video: its switch and Screen Media Source, then the shared media fields. */
const props = defineProps<{
	media?: ScreenMediaBackgroundConfig;
	eventId: number;
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

/** The video's source is required, so a cleared choice stores an unset URL. */
function updateSource(source: ScreenMediaSource | null) {
	emit('update', { source: source ?? { kind: 'url', url: '' } });
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
			<ScreenMediaSourceField
				:model-value="media.source"
				:event-id="eventId"
				asset-kind="silent-video"
				label="Video asset"
				@update:model-value="updateSource"
			/>

			<GraphicsMediaFields
				:media="media"
				opacity
				playback
				@update="updateMedia"
			/>
		</template>
	</div>
</template>
