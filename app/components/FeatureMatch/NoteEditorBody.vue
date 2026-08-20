<script setup lang="ts">
withDefaults(defineProps<{
	note: string;
	draft: string;
	saving: boolean;
	error: string | null;
	confirmingClear: boolean;
	hasNote: boolean;
	compact?: boolean;
}>(), {
	compact: false,
});

defineEmits<{
	'update:draft': [value: string];
	'keydown': [event: KeyboardEvent];
	'save': [];
	'cancel': [];
	'requestClear': [];
	'keepNote': [];
	'confirmClear': [];
}>();
</script>

<template>
	<div class="space-y-3">
		<UTextarea
			:model-value="draft"
			data-testid="note-input"
			:rows="compact ? 3 : 5"
			:maxlength="5000"
			placeholder="Add supplementary Match information for Talent…"
			autofocus
			class="w-full"
			@update:model-value="$emit('update:draft', $event)"
			@keydown="$emit('keydown', $event)"
		/>
		<div class="flex items-center justify-between gap-3 text-xs text-muted">
			<span>Ctrl+Enter or Cmd+Enter to save</span>
			<span>{{ draft.length.toLocaleString() }} / 5,000</span>
		</div>
		<p
			v-if="error"
			data-testid="note-error"
			class="text-sm text-error"
			role="alert"
		>
			{{ error }}
		</p>
		<div
			v-if="confirmingClear"
			data-testid="note-clear-confirmation"
			class="rounded-md border border-error/40 bg-error/5 p-3"
		>
			<p class="text-sm font-medium">
				Clear this Note?
			</p>
			<p class="mt-1 whitespace-pre-wrap break-words text-sm text-muted">
				{{ note }}
			</p>
			<div class="mt-3 flex flex-wrap justify-end gap-2">
				<UButton
					color="neutral"
					variant="ghost"
					size="sm"
					@click="$emit('keepNote')"
				>
					Keep Note
				</UButton>
				<UButton
					data-testid="note-confirm-clear"
					color="error"
					size="sm"
					:loading="saving"
					@click="$emit('confirmClear')"
				>
					Clear Note
				</UButton>
			</div>
		</div>
		<div v-else class="flex flex-wrap items-center justify-between gap-2">
			<UButton
				v-if="hasNote"
				data-testid="note-clear"
				color="error"
				variant="ghost"
				size="sm"
				:disabled="saving"
				@click="$emit('requestClear')"
			>
				Clear
			</UButton>
			<span v-else />
			<div class="flex gap-2">
				<UButton
					color="neutral"
					variant="ghost"
					size="sm"
					:disabled="saving"
					@click="$emit('cancel')"
				>
					Cancel
				</UButton>
				<UButton
					data-testid="note-save"
					color="primary"
					size="sm"
					:loading="saving"
					:disabled="draft.length > 5000"
					@click="$emit('save')"
				>
					Save Note
				</UButton>
			</div>
		</div>
	</div>
</template>
