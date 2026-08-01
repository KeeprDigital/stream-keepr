import type { Ref } from 'vue';

/**
 * One reading of a library in the reusable-library scope.
 *
 * Three surfaces browse a library in that scope — the Broadcast Graphic Template
 * library, the Feature Match Layout Template library, and the Graphic Style Set library
 * — and each does the same three things around whatever else it offers: it re-reads the
 * library, it turns a refused write into something an author can read, and it holds that
 * message until the author has seen it.
 *
 * Deliberately not named for the Graphics Asset Library, which is a different thing: that
 * one owns the image, silent video, and font bytes these libraries' artifacts reference,
 * and is what `useGraphicsAdminReading` and `useGraphicsIngestionTransfer` next door
 * speak to. This one reads a list of authoring artifacts and knows nothing about assets.
 *
 * What it deliberately does not own is importing. The three libraries receive different
 * portable artifacts and an import means a different thing in each, so the import path
 * stays with the library that has the semantics.
 */
export interface ReusableLibraryReading<Entry> extends ReusableLibraryFailures {
	/** The library as it was last read. */
	entries: Ref<Entry[]>;
	loading: Ref<boolean>;
}

/**
 * The part of a library a collaborator needs to report through: the message an author
 * is looking at, how a caught value becomes one, and how to go back to the server.
 */
export interface ReusableLibraryFailures {
	/** The one message an author is looking at, or none. */
	error: Ref<string | null>;
	failureMessage: (caught: unknown) => string;
	refresh: (keepError?: boolean) => Promise<void>;
}

export function useReusableLibraryReading<Entry>(options: {
	/** Re-read the whole library. */
	read: () => Promise<Entry[]>;
	/** What to say when the failure carries no message of its own. */
	unavailable: string;
	/**
	 * Called with a caught value before its message is derived, for a library whose
	 * refusals carry structured detail beside the message. The Graphic Style Set library
	 * is the one that does: a draft it cannot publish is refused with every reason at
	 * once, and losing them would leave the author only "cannot be published".
	 */
	inspectFailure?: (caught: unknown) => void;
}): ReusableLibraryReading<Entry> {
	const entries = ref<Entry[]>([]) as Ref<Entry[]>;
	const loading = ref(false);
	const error = ref<string | null>(null);

	function failureMessage(caught: unknown): string {
		options.inspectFailure?.(caught);
		const data = (caught as { data?: { message?: string } })?.data;
		if (typeof data?.message === 'string' && data.message.length > 0)
			return data.message;
		return caught instanceof Error ? caught.message : options.unavailable;
	}

	/**
	 * Re-read the library.
	 *
	 * `keepError` exists for the one case that matters: a refused write re-reads the
	 * library so the author is looking at what actually exists, and a successful re-read
	 * must not then erase the message explaining why their write was refused.
	 */
	async function refresh(keepError = false) {
		loading.value = true;
		try {
			entries.value = await options.read();
			if (!keepError)
				error.value = null;
		}
		catch (caught) {
			error.value = failureMessage(caught);
		}
		finally {
			loading.value = false;
		}
	}

	return { entries, loading, error, failureMessage, refresh };
}
