interface FeatureMatchNoteEditorOptions {
	note: () => string;
	noteKey: () => number | string | null | undefined;
	save: (note: string) => Promise<unknown>;
}

/** Shared explicit-save behavior for roomy Note panels and the dense popover. */
export function useFeatureMatchNoteEditor(options: FeatureMatchNoteEditorOptions) {
	const active = ref(false);
	const draft = ref(options.note());
	const saving = ref(false);
	const error = ref<string | null>(null);
	const confirmingClear = ref(false);
	const hasNote = computed(() => options.note().trim().length > 0);

	function resetDraft() {
		draft.value = options.note();
		error.value = null;
		confirmingClear.value = false;
	}

	watch(options.noteKey, () => {
		resetDraft();
		active.value = false;
	});

	watch(options.note, () => {
		if (!active.value)
			resetDraft();
	});

	watch(active, (isActive) => {
		if (isActive)
			resetDraft();
	});

	function openEditor() {
		active.value = true;
	}

	function cancelEditing() {
		resetDraft();
		active.value = false;
	}

	async function commit(note: string) {
		if (saving.value)
			return;
		const normalized = note.trim();
		if (normalized === options.note().trim()) {
			cancelEditing();
			return;
		}
		saving.value = true;
		error.value = null;
		try {
			await options.save(normalized);
			active.value = false;
			confirmingClear.value = false;
		}
		catch (cause) {
			error.value = cause instanceof Error ? cause.message : 'The Note could not be saved.';
		}
		finally {
			saving.value = false;
		}
	}

	function saveDraft() {
		if (!draft.value.trim() && hasNote.value) {
			confirmingClear.value = true;
			return;
		}
		void commit(draft.value);
	}

	function requestClear() {
		draft.value = '';
		confirmingClear.value = true;
	}

	function confirmClear() {
		void commit('');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			saveDraft();
		}
	}

	return {
		active,
		draft,
		saving,
		error,
		confirmingClear,
		hasNote,
		openEditor,
		cancelEditing,
		commit,
		saveDraft,
		requestClear,
		confirmClear,
		handleKeydown,
	};
}
