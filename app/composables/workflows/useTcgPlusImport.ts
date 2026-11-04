import type { TcgPlusImportAnswer, TcgPlusImportPreview } from '~~/shared/types/tcgPlusImport';

/** Where a TCG+ Import stands: nothing chosen, a preview on the way or shown, the import on the way or done, or a failure. */
export type TcgPlusImportStatus = 'idle' | 'previewing' | 'previewed' | 'importing' | 'imported' | 'failed';

const PREVIEW_REQUEST = Symbol('tcgplus-preview');

/**
 * The TCG+ Import workflow (ADR-0074): a chosen export is read as text and
 * previewed, which saves nothing, and imported only once confirmed. A failed
 * preview or import shows why, and the operator chooses the file again.
 */
export function useTcgPlusImport(eventId: () => number | null) {
	const repository = useTcgPlusImportRepository();
	const { runRequest, getErrorMessage } = useRequestFeedback();

	const fileName = ref<string | null>(null);
	const csv = ref<string | null>(null);
	const preview = ref<TcgPlusImportPreview | null>(null);
	const answer = ref<TcgPlusImportAnswer | null>(null);
	const error = ref<string | null>(null);
	const previewing = ref(false);
	const importing = ref(false);

	const status = computed<TcgPlusImportStatus>(() => {
		if (previewing.value)
			return 'previewing';
		if (importing.value)
			return 'importing';
		if (error.value)
			return 'failed';
		if (answer.value)
			return 'imported';
		return preview.value
			? 'previewed'
			: 'idle';
	});

	function reset() {
		preview.value = null;
		answer.value = null;
		error.value = null;
	}

	async function choose(file: File) {
		const id = eventId();
		if (!id)
			return;
		reset();
		fileName.value = file.name;
		previewing.value = true;
		let text: string;
		try {
			text = await file.text();
		}
		catch (readError) {
			previewing.value = false;
			error.value = getErrorMessage(readError, 'The file could not be read');
			return;
		}
		csv.value = text;
		await runRequest(() => repository.preview(id, text), {
			loadingRef: previewing,
			errorRef: error,
			error: false,
			// A file chosen while another's preview is on the way replaces it.
			latestKey: PREVIEW_REQUEST,
			onSuccess: (previewed) => {
				preview.value = previewed;
			},
		});
	}

	async function confirm() {
		const id = eventId();
		if (!id || !csv.value || !preview.value)
			return;
		error.value = null;
		await runRequest(() => repository.commit(id, csv.value!), {
			loadingRef: importing,
			errorRef: error,
			error: false,
			success: imported => ({ title: imported.message, color: 'success' }),
			onSuccess: (imported) => {
				answer.value = imported;
				preview.value = null;
				csv.value = null;
			},
		});
	}

	function dismiss() {
		reset();
		csv.value = null;
		fileName.value = null;
	}

	return {
		status,
		fileName: readonly(fileName),
		preview: readonly(preview),
		answer: readonly(answer),
		error: readonly(error),
		choose,
		confirm,
		dismiss,
	};
}
