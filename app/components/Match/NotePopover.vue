<script setup lang="ts">
const props = defineProps<{
	note: string;
	noteKey?: number | string | null;
	contentAlign?: 'start' | 'end';
}>();

const emit = defineEmits<{
	save: [note: string];
}>();

const open = ref(false);
const draft = ref('');

const hasNote = computed(() => props.note.trim().length > 0);

watch(
	() => [props.noteKey, props.note] as const,
	() => {
		draft.value = props.note;
	},
	{ immediate: true },
);

function saveNote() {
	if (draft.value.trim() === props.note.trim()) {
		open.value = false;
		return;
	}
	emit('save', draft.value);
	open.value = false;
}

function clearNote() {
	draft.value = '';
	saveNote();
}

function cancelNote() {
	draft.value = props.note;
	open.value = false;
}
</script>

<template>
	<UPopover
		v-model:open="open"
		:content="{ align: contentAlign }"
	>
		<slot />

		<template #content>
			<div class="match-note-popover">
				<div class="flex items-center gap-2 text-sm font-medium text-default">
					<UIcon name="i-lucide-sticky-note" class="size-4 text-primary" />
					Feature match note
				</div>
				<UTextarea
					v-model="draft"
					placeholder="Add production notes for this feature match…"
					:rows="4"
					autofocus
					class="w-full"
				/>
				<div class="flex items-center justify-between gap-2">
					<UButton
						color="neutral"
						variant="ghost"
						size="sm"
						:disabled="!hasNote && !draft.trim()"
						@click="clearNote"
					>
						Clear
					</UButton>
					<div class="flex items-center gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							size="sm"
							@click="cancelNote"
						>
							Cancel
						</UButton>
						<UButton
							color="primary"
							size="sm"
							@click="saveNote"
						>
							Save note
						</UButton>
					</div>
				</div>
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
