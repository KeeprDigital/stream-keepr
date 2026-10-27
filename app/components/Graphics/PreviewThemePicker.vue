<script setup lang="ts">
/**
 * Which Theme a graphics editor previews under (#829). Changes the preview and
 * the bound properties the inspector shows, and nothing stored.
 */
defineProps<{
	items: readonly { label: string; value: string }[];
}>();

const choice = defineModel<string>({ required: true });
</script>

<template>
	<div class="flex items-center gap-2 text-xs text-muted">
		<UIcon name="i-lucide-swatch-book" class="size-3.5 shrink-0" />
		<span>Preview under</span>
		<USelect
			v-model="choice"
			:items="[...items]"
			size="xs"
			class="w-48"
			aria-label="Preview Theme"
			data-testid="graphics-preview-theme"
		/>
	</div>
</template>
