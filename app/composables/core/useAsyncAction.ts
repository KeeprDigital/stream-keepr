interface AsyncActionOptions {
	loadingRef?: Ref<boolean>;
	errorRef?: Ref<string | null>;
	onError?: (error: unknown) => void;
	throwError?: boolean;
}

export function useAsyncAction() {
	const executeAction = async <T>(
		action: () => Promise<T>,
		options: AsyncActionOptions = {},
	): Promise<T | null> => {
		const {
			loadingRef,
			errorRef,
			onError,
			throwError = false,
		} = options;

		if (loadingRef)
			loadingRef.value = true;
		if (errorRef)
			errorRef.value = null;

		try {
			const result = await action();
			return result;
		}
		catch (e) {
			const errorMessage = e instanceof Error ? e.message : 'An error occurred';

			if (errorRef) {
				errorRef.value = errorMessage;
			}

			if (onError) {
				onError(e);
			}

			if (throwError) {
				throw e;
			}

			return null;
		}
		finally {
			if (loadingRef)
				loadingRef.value = false;
		}
	};

	return {
		executeAction,
	};
}
