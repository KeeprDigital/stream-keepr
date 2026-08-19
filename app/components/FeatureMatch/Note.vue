<script setup lang="ts">
const props = withDefaults(defineProps<{
	note: string;
	noteKey: number | string;
	save: (note: string) => Promise<unknown>;
	compact?: boolean;
	remoteChanged?: boolean;
}>(), {
	compact: false,
	remoteChanged: false,
});

const expanded = ref(false);
const isLong = computed(() => props.note.split('\n').length > 4 || props.note.length > 160);
const {
	active: editing,
	draft,
	saving,
	error,
	confirmingClear,
	hasNote,
	openEditor: beginEditing,
	cancelEditing,
	saveDraft,
	requestClear,
	confirmClear,
	handleKeydown,
} = useFeatureMatchNoteEditor({
	note: () => props.note,
	noteKey: () => props.noteKey,
	save: note => props.save(note),
});

watch(() => props.noteKey, () => {
	expanded.value = false;
});
</script>

<template>
	<section
		class="feature-match-note rounded-lg border transition-colors"
		:class="[
			compact ? 'px-3 py-2' : 'p-4',
			remoteChanged ? 'border-primary bg-primary/10' : 'border-default bg-elevated/40',
		]"
		:data-remote-changed="String(remoteChanged)"
	>
		<div class="flex items-center justify-between gap-3">
			<div class="flex items-center gap-2 min-w-0">
				<UIcon name="i-lucide-sticky-note" class="size-4 shrink-0 text-muted" />
				<h3 class="text-sm font-medium text-muted">
					Production Note
				</h3>
			</div>
			<UButton
				v-if="!editing"
				data-testid="note-edit"
				color="neutral"
				variant="ghost"
				size="xs"
				:label="hasNote ? 'Edit' : 'Add Note'"
				@click="beginEditing"
			/>
		</div>

		<FeatureMatchNoteEditorBody
			v-if="editing"
			v-model:draft="draft"
			class="mt-3"
			:note="note"
			:saving="saving"
			:error="error"
			:confirming-clear="confirmingClear"
			:has-note="hasNote"
			:compact="compact"
			@keydown="handleKeydown"
			@save="saveDraft"
			@cancel="cancelEditing"
			@request-clear="requestClear"
			@keep-note="confirmingClear = false"
			@confirm-clear="confirmClear"
		/>

		<div v-else class="mt-2">
			<p
				v-if="hasNote"
				data-testid="note-text"
				class="break-words text-sm text-default"
				:class="{ 'line-clamp-4': !expanded }"
				style="white-space: pre-wrap"
			>
				{{ note }}
			</p>
			<p v-else data-testid="note-empty" class="text-sm text-dimmed">
				No production note
			</p>
			<UButton
				v-if="hasNote && isLong"
				data-testid="note-expand"
				color="neutral"
				variant="link"
				size="xs"
				class="mt-1 px-0"
				@click="expanded = !expanded"
			>
				{{ expanded ? 'Collapse' : 'Expand' }}
			</UButton>
		</div>
	</section>
</template>
