<script setup lang="ts">
defineProps<{
	isDirty: boolean;
	loading?: boolean;
}>();

const emit = defineEmits<{
	reset: [];
}>();
</script>

<template>
	<div class="flex justify-between items-center gap-4">
		<UButton
			label="Reset"
			color="error"
			variant="ghost"
			type="button"
			:disabled="!isDirty"
			@click="emit('reset')"
		/>
		<UButton
			label="Save"
			type="submit"
			variant="outline"
			:loading="loading"
			:disabled="!isDirty"
			color="primary"
		/>
	</div>
</template>
