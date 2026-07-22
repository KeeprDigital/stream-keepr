interface BroadcastDisplayDataOptions<T> {
	initialData: T;
	/** Clear displayed data when the selected source is explicitly removed. */
	clearOnMissingSource?: boolean;
}

/**
 * Stale-while-revalidate state for broadcast display screens.
 *
 * Existing data remains visible while refreshes are in-flight. Failed refreshes only
 * surface an error when there is no previously displayed data to keep on screen.
 */
export function useBroadcastDisplayData<T>(options: BroadcastDisplayDataOptions<T>) {
	const data = ref<T>(options.initialData) as Ref<T>;
	const loading = ref(false);
	const error = ref<string | null>(null);
	const hasDisplayedData = ref(false);
	let requestId = 0;

	function clear() {
		requestId++;
		data.value = options.initialData;
		hasDisplayedData.value = false;
		loading.value = false;
		error.value = null;
	}

	async function refresh(fetcher: () => Promise<T>, errorMessage: string) {
		const id = ++requestId;
		loading.value = true;
		error.value = null;

		try {
			const next = await fetcher();
			if (id !== requestId) {
				return;
			}

			data.value = next;
			hasDisplayedData.value = true;
			error.value = null;
		}
		catch (cause) {
			console.error(errorMessage, cause);
			if (id !== requestId) {
				return;
			}

			if (!hasDisplayedData.value) {
				error.value = errorMessage;
			}
		}
		finally {
			if (id === requestId) {
				loading.value = false;
			}
		}
	}

	return {
		data,
		loading,
		error,
		hasDisplayedData,
		clear,
		refresh,
	};
}
