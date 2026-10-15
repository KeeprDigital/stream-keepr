<script setup lang="ts">
import type { MediaFit } from '~~/shared/types/graphicItem';
import type { MediaFieldsPatch, MediaFieldsValue } from '~/utils/mediaFields';
import { MAX_GRAPHIC_MEDIA_PLAYBACK_RATE, MIN_GRAPHIC_MEDIA_PLAYBACK_RATE } from '~~/shared/types/graphics';
import { MEDIA_FIT_OPTIONS } from '~/utils/mediaFields';

/**
 * The one media fields control: Media Fit, opacity, focal position, playback
 * rate, and loop, for a Media Graphic Item, a media treatment entry, an image or
 * video Background Layer, and the Feature Match Overlay Frame's video.
 *
 * Fit is always offered. The rest are offered by prop, because not every host's
 * renderer has them: a Background Layer owns its opacity outside its media, only
 * the graphics renderers place media at a focal position, and only video plays.
 *
 * Each edit is emitted as a patch of that one field. A cleared opacity or
 * playback rate is `null`, which a host turns into its default with
 * `resolveMediaFieldsPatch`. The playback-rate bounds are the ones every host's
 * schema stores: 0.25–4, a Media Graphic Item's.
 */
const props = withDefaults(defineProps<{
	media: MediaFieldsValue;
	opacity?: boolean;
	focal?: boolean;
	playback?: boolean;
	size?: 'xs' | 'sm';
	disabled?: boolean;
}>(), {
	size: 'sm',
});

const emit = defineEmits<{ update: [patch: MediaFieldsPatch] }>();

const focalPosition = computed(() => props.media.focalPosition ?? { horizontal: 0.5, vertical: 0.5 });

/** A cleared focal axis returns to the centre. */
function updateFocal(axis: 'horizontal' | 'vertical', value: number | null | undefined) {
	emit('update', { focalPosition: { ...focalPosition.value, [axis]: value ?? 0.5 } });
}
</script>

<template>
	<div class="grid grid-cols-2 gap-2">
		<UFormField label="Fit" :size="size">
			<USelect
				:model-value="media.fit"
				:items="MEDIA_FIT_OPTIONS"
				value-key="value"
				:size="size"
				class="w-full"
				:disabled="disabled"
				data-testid="media-fit"
				@update:model-value="emit('update', { fit: $event as MediaFit })"
			/>
		</UFormField>
		<UFormField v-if="opacity" label="Opacity" :size="size">
			<UIOpacityInput
				:model-value="media.opacity"
				:size="size"
				class="w-full"
				:disabled="disabled"
				data-testid="media-opacity"
				aria-label="Media opacity"
				@update:model-value="emit('update', { opacity: $event ?? null })"
			/>
		</UFormField>
		<template v-if="focal">
			<UFormField label="Focal X" :size="size">
				<UInputNumber
					:model-value="focalPosition.horizontal"
					:min="0"
					:max="1"
					:step="0.05"
					:size="size"
					class="w-full"
					:disabled="disabled"
					data-testid="media-focal-horizontal"
					aria-label="Horizontal focal position"
					@update:model-value="updateFocal('horizontal', $event)"
				/>
			</UFormField>
			<UFormField label="Focal Y" :size="size">
				<UInputNumber
					:model-value="focalPosition.vertical"
					:min="0"
					:max="1"
					:step="0.05"
					:size="size"
					class="w-full"
					:disabled="disabled"
					data-testid="media-focal-vertical"
					aria-label="Vertical focal position"
					@update:model-value="updateFocal('vertical', $event)"
				/>
			</UFormField>
		</template>
		<template v-if="playback">
			<UFormField label="Playback rate" :size="size">
				<UInputNumber
					:model-value="media.playbackRate"
					:min="MIN_GRAPHIC_MEDIA_PLAYBACK_RATE"
					:max="MAX_GRAPHIC_MEDIA_PLAYBACK_RATE"
					:step="0.05"
					:size="size"
					class="w-full"
					:disabled="disabled"
					data-testid="media-playback-rate"
					aria-label="Playback rate"
					@update:model-value="emit('update', { playbackRate: $event ?? null })"
				/>
			</UFormField>
			<UFormField label="Loop" :size="size">
				<USwitch
					:model-value="media.loop"
					:disabled="disabled"
					data-testid="media-loop"
					@update:model-value="emit('update', { loop: $event })"
				/>
			</UFormField>
		</template>
	</div>
</template>
