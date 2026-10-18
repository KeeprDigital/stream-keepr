import type { Flight } from '~/utils/guardedSequence';

export interface AsyncActionOptions {
	loadingRef?: Ref<boolean>;
	errorRef?: Ref<string | null>;
	onError?: (error: unknown) => void;
	throwError?: boolean;
	/**
	 * The Flight the action belongs to. Once it is stale the action settles without
	 * touching `loadingRef` or `errorRef` and without calling `onError`: the state
	 * they describe has been superseded. The result is still returned, and a
	 * `throwError` failure still raised, to the caller that started it.
	 */
	flight?: Flight;
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
			flight = unguarded,
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

			if (errorRef && flight.current) {
				errorRef.value = errorMessage;
			}

			if (onError && flight.current) {
				onError(e);
			}

			if (throwError) {
				throw e;
			}

			return null;
		}
		finally {
			if (loadingRef && flight.current)
				loadingRef.value = false;
		}
	};

	return {
		executeAction,
	};
}
