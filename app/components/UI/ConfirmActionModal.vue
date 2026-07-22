<script setup lang="ts">
const props = withDefaults(defineProps<{
	title?: string;
	message?: string;
	description?: string;
	icon?: string;
	iconColor?: string;
	confirmLabel?: string;
	confirmColor?: 'primary' | 'error' | 'warning' | 'success' | 'neutral';
	loading?: boolean;
}>(), {
	title: 'Confirm',
	message: 'Are you sure?',
	icon: 'i-lucide-alert-circle',
	iconColor: 'text-warning',
	confirmLabel: 'Confirm',
	confirmColor: 'primary',
});

const emit = defineEmits<{
	(e: 'close', result: boolean): void;
}>();

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
		:title="props.title"
		:close="{ onClick: handleClose }"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="flex items-start gap-3">
				<UIcon :name="props.icon" class="size-5 mt-0.5 shrink-0" :class="[props.iconColor]" />
				<div>
					<p class="text-muted">
						{{ props.message }}
					</p>
					<p v-if="props.description" class="text-sm text-muted mt-2">
						{{ props.description }}
					</p>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton
				variant="ghost"
				color="neutral"
				:disabled="props.loading"
				@click="handleClose"
			>
				Cancel
			</UButton>
			<UButton
				:color="props.confirmColor"
				:loading="props.loading"
				@click="handleConfirm"
			>
				{{ props.confirmLabel }}
			</UButton>
		</template>
	</UModal>
</template>
