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
 *
 * The first read is owned here too. All three surfaces are browsers of a library and
 * every one of them opened with the same `onMounted(() => void refresh())`; a library
 * that read nothing until something asked would be a surface showing an empty list it
 * has no evidence for.
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
	/**
	 * Whether the last refusal was the graphics author session ending.
	 *
	 * Separate from `error` because it is the one refusal with an action attached:
	 * every other message tells an author what to do differently, and this one tells
	 * them there is nobody left to do it as.
	 */
	lapsed: Ref<boolean>;
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
	const authorSession = useGraphicsAuthorSession();

	/**
	 * Every refusal these three libraries report passes through here, which is why
	 * the graphics author session is recognised here rather than at each call site.
	 *
	 * All three write through routes that require that session, and importing a
	 * portable artifact runs as a Graphics Ingestion Operation on the Graphics Asset
	 * Library's own routes — so a lapse can arrive from either, and it reaches an
	 * author as the server's sentence about a session they cannot see unless it is
	 * named here. An import is also the surface most likely to be open when a
	 * session runs out, because it is the one that pauses for a confirmation.
	 *
	 * The refusal's own sentence is read through `failureSentence`, which is where the
	 * judgement about *which* failures wrote one lives. This used to read `data.message`
	 * unguarded, and an unmapped 5xx body on this server carries 'Internal Server Error'
	 * — a placeholder `mapPublicNitroError` writes over whatever actually failed — so an
	 * author was shown machinery in the authority's voice (#262). A 4xx sentence reads
	 * exactly as it did, and so does a 5xx whose prose the mapper preserved, which on
	 * these routes is an exhausted byte store or a named dependency that is down (#286).
	 */
	function failureMessage(caught: unknown): string {
		options.inspectFailure?.(caught);
		if (graphicsAuthorSessionLapsed(caught))
			return authorSession.describeFailure(caught, options.unavailable);
		return reportedMessage(caught, options.unavailable);
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

	onMounted(() => {
		void refresh();
	});

	return { entries, loading, error, lapsed: authorSession.lapsed, failureMessage, refresh };
}
