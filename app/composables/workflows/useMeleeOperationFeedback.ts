interface AfterMeleeOperation {
	onSuccess?: () => void | Promise<void>;
	onFailure?: () => void | Promise<void>;
}

/**
 * Runs a Melee operation and tells the operator what the Melee store recorded of
 * it: the title and description the store composed, coloured by its status. Every
 * page that starts an operation reports through here, so a committed sync whose
 * reload failed says "Reload Needed" wherever it was started.
 */
export function useMeleeOperationFeedback() {
	const meleeStore = useMeleeStore();
	const { runRequest } = useRequestFeedback();

	async function reportMeleeOperation<T>(action: () => Promise<T>, after: AfterMeleeOperation = {}) {
		const earlier = meleeStore.lastOperation;
		// An operation that recorded nothing, refused before it started or answered
		// after the operator moved on, must not repeat what an earlier one recorded.
		function recorded() {
			const operation = meleeStore.lastOperation;
			return operation && operation !== earlier
				? { title: operation.title, description: operation.description, color: operation.status }
				: null;
		}

		return runRequest(action, {
			success: () => recorded() ?? false,
			error: ({ message }) => recorded() ?? { title: 'Operation Failed', description: message, color: 'error' },
			...after,
		});
	}

	return { reportMeleeOperation };
}
