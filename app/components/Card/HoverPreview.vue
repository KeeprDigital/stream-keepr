<script setup lang="ts">
/**
 * Shared card image hover preview.
 * Wraps a slot trigger in a UPopover that shows a card image on hover.
 *
 * Usage:
 * ```vue
 * <CardHoverPreview :image-url="url" :alt="cardName" :is-active="isActive" @preview="onPreview" @pin="onPin">
 *   <span>{{ cardName }}</span>
 * </CardHoverPreview>
 * ```
 */

withDefaults(defineProps<{
	/** Full image URL for the preview (Scryfall normal or art_crop) */
	imageUrl: string | null;
	/** Alt text for the image */
	alt: string;
	/** Whether this preview is currently active/visible */
	isActive: boolean;
	/** Image width in px */
	width?: number;
	/** Image height in px */
	height?: number;
	/** Popover side */
	side?: 'top' | 'right' | 'bottom' | 'left';
	/** Border radius style for the image */
	borderRadius?: string;
}>(), {
	width: 244,
	height: 340,
	side: 'right',
	borderRadius: '4.75% / 4%',
});

const emit = defineEmits<{
	(e: 'preview', open: boolean): void;
	(e: 'pin'): void;
}>();
</script>

<template>
	<UPopover
		mode="hover"
		:open="!!imageUrl && isActive"
		:open-delay="300"
		:close-delay="100"
		:content="{ side, align: 'start', sideOffset: 8 }"
		@update:open="(val: boolean) => emit('preview', val)"
	>
		<span
			class="cursor-pointer"
			@click.stop="emit('pin')"
		>
			<slot />
		</span>
		<template #content>
			<div class="p-1" @click.stop>
				<NuxtImg
					:src="imageUrl!"
					:alt="alt"
					:width="width"
					:height="height"
					:style="{ borderRadius }"
					loading="lazy"
				/>
			</div>
		</template>
	</UPopover>
</template>
