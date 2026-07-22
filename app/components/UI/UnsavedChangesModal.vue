<script setup lang="ts">
const emit = defineEmits<{
	(e: 'close', result: boolean): void;
}>();

function handleDiscard() {
	emit('close', true);
}

function handleCancel() {
	emit('close', false);
}

useEnterToSubmit(handleDiscard);
</script>

<template>
	<UModal
		title="Unsaved Changes"
		:close="{ onClick: handleCancel }"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="flex items-start gap-3">
				<UIcon name="i-lucide-alert-triangle" class="text-warning size-5 mt-0.5 shrink-0" />
				<div>
					<p class="text-muted">
						You have unsaved changes. Are you sure you want to leave?
					</p>
					<p class="text-sm text-muted mt-2">
						Your changes will be lost.
					</p>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton
				variant="ghost"
				color="neutral"
				@click="handleCancel"
			>
				Cancel
			</UButton>
			<UButton
				color="error"
				@click="handleDiscard"
			>
				Discard Changes
			</UButton>
		</template>
	</UModal>
</template>
