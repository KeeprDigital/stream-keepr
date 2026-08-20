<script setup lang="ts">
const props = defineProps<{
	note: string;
	noteKey?: number | string | null;
	contentAlign?: 'start' | 'end';
	save: (note: string) => Promise<unknown>;
	remoteChanged?: boolean;
}>();

const {
	active: open,
	draft,
	saving,
	error,
	confirmingClear,
	hasNote,
	cancelEditing: cancelNote,
	saveDraft: saveNote,
	requestClear,
	confirmClear,
	handleKeydown,
} = useFeatureMatchNoteEditor({
	note: () => props.note,
	noteKey: () => props.noteKey,
	save: note => props.save(note),
});
</script>

<template>
	<UPopover v-model:open="open" :content="{ align: contentAlign }">
		<span :data-remote-changed="String(remoteChanged ?? false)">
			<slot />
		</span>

		<template #content>
			<div class="match-note-popover">
				<div class="flex items-center gap-2 text-sm font-medium text-default">
					<UIcon name="i-lucide-sticky-note" class="size-4 text-muted" />
					Feature Match Note
				</div>
				<FeatureMatchNoteEditorBody
					v-model:draft="draft"
					:note="note"
					:saving="saving"
					:error="error"
					:confirming-clear="confirmingClear"
					:has-note="hasNote"
					compact
					@keydown="handleKeydown"
					@save="saveNote"
					@cancel="cancelNote"
					@request-clear="requestClear"
					@keep-note="confirmingClear = false"
					@confirm-clear="confirmClear"
				/>
			</div>
		</template>
	</UPopover>
</template>

<style scoped>
.match-note-popover {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	width: min(22rem, calc(100vw - 2rem));
	padding: 0.75rem;
}
</style>
