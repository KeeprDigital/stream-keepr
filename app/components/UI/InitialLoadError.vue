<script setup lang="ts">
defineProps<{
	error: string;
}>();

const emit = defineEmits<{
	retry: [];
}>();
</script>

<template>
	<div class="flex min-h-64 items-center justify-center p-6" role="alert">
		<UCard variant="subtle" class="w-full max-w-xl">
			<div class="flex flex-col items-center gap-3 py-6 text-center">
				<UIcon name="i-lucide-circle-alert" class="size-12 text-error" />
				<h2 class="text-lg font-semibold">
					Unable to load this page
				</h2>
				<p class="text-sm text-muted">
					{{ error }}
				</p>
				<UButton icon="i-lucide-refresh-cw" @click="emit('retry')">
					Try Again
				</UButton>
			</div>
		</UCard>
	</div>
</template>
