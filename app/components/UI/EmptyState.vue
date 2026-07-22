<script setup lang="ts">
withDefaults(defineProps<{
	icon: string;
	title: string;
	description?: string;
	variant?: 'page' | 'card' | 'inline';
}>(), {
	variant: 'card',
});
</script>

<template>
	<!-- Page/card variant: wrapped in UCard for page-level empty states -->
	<div v-if="variant === 'page' || variant === 'card'" :class="variant === 'page' ? 'flex min-h-[calc(100dvh-12rem)] items-center justify-center' : 'text-center py-12'">
		<UCard variant="subtle" class="w-full max-w-xl mx-auto">
			<div class="flex flex-col items-center gap-3 py-6 text-center">
				<UIcon :name="icon" class="h-12 w-12 text-muted" />
				<h3 class="text-lg font-semibold">
					{{ title }}
				</h3>
				<p v-if="description" class="text-sm text-muted text-center">
					{{ description }}
				</p>
				<slot name="actions" />
			</div>
		</UCard>
	</div>

	<!-- Inline variant: no card wrapper, for use inside existing cards or modals -->
	<div v-else class="flex flex-col items-center justify-center text-center text-muted py-8">
		<UIcon :name="icon" class="text-3xl mb-2" />
		<p>{{ title }}</p>
		<p v-if="description" class="text-sm mt-1">
			{{ description }}
		</p>
		<slot name="actions" />
	</div>
</template>
