<script setup lang="ts">
/**
 * Forward, backward, and delete for one entry of an ordered graphics list —
 * a Broadcast Graphic in the Screen stack, or a Graphic Item in a Graphic
 * Layer Order. The list is back-to-front, so "forward" moves towards the end.
 */
defineProps<{
	/** Names the entry in each control's accessible label. */
	label: string;
	canMoveForward: boolean;
	canMoveBackward: boolean;
}>();

const emit = defineEmits<{
	move: [delta: 1 | -1];
	remove: [];
}>();
</script>

<template>
	<div class="flex shrink-0 flex-col gap-1">
		<UButton
			size="xs"
			variant="ghost"
			color="neutral"
			icon="i-lucide-chevron-up"
			:disabled="!canMoveForward"
			:aria-label="`Move ${label} forward`"
			@click="emit('move', 1)"
		/>
		<UButton
			size="xs"
			variant="ghost"
			color="neutral"
			icon="i-lucide-chevron-down"
			:disabled="!canMoveBackward"
			:aria-label="`Move ${label} backward`"
			@click="emit('move', -1)"
		/>
		<UButton
			size="xs"
			variant="ghost"
			color="error"
			icon="i-lucide-trash-2"
			:aria-label="`Delete ${label}`"
			@click="emit('remove')"
		/>
	</div>
</template>
