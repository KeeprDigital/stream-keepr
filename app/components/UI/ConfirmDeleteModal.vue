<script setup lang="ts">
const props = defineProps<{
	title?: string;
	itemName?: string;
	loading?: boolean;
}>();

const emit = defineEmits<{
	(e: 'close', result: boolean): void;
}>();

const modalTitle = computed(() => props.title || 'Confirm Delete');
const message = computed(() =>
	props.itemName
		? `Are you sure you want to delete "${props.itemName}"?`
		: 'Are you sure you want to delete this item?',
);

function handleConfirm() {
	emit('close', true);
}

function handleClose() {
	emit('close', false);
}

useEnterToSubmit(handleConfirm, { disabled: () => props.loading });
</script>

<template>
	<UModal
		:title="modalTitle"
		:close="{ onClick: handleClose }"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="flex items-start gap-3">
				<UIcon name="i-lucide-alert-triangle" class="text-error size-5 mt-0.5 shrink-0" />
				<div>
					<p class="text-muted">
						{{ message }}
					</p>
					<p class="text-sm text-muted mt-2">
						This action cannot be undone.
					</p>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton
				variant="ghost"
				color="neutral"
				:disabled="loading"
				@click="handleClose"
			>
				Cancel
			</UButton>
			<UButton
				color="error"
				:loading="loading"
				@click="handleConfirm"
			>
				Delete
			</UButton>
		</template>
	</UModal>
</template>
