type MaybePromise<T> = T | Promise<T>;
type ToastOptions = Parameters<ReturnType<typeof useToast>['add']>[0];
type SuccessfulResult<T> = Exclude<T, null | undefined | false>;
type ToastResolver<TPayload> = ToastOptions | false | ((payload: TPayload) => ToastOptions | false | null | undefined);

interface RequestFailure<T> {
	message: string;
	error?: unknown;
	result?: T;
}

interface RunRequestOptions<T> {
	loadingRef?: Ref<boolean>;
	errorRef?: Ref<string | null>;
	success?: ToastResolver<SuccessfulResult<T>>;
	error?: ToastResolver<RequestFailure<T>>;
	onSuccess?: (result: SuccessfulResult<T>) => MaybePromise<void>;
	onFailure?: (failure: RequestFailure<T>) => MaybePromise<void>;
	isSuccess?: (result: T) => boolean;
	/** Only the latest request with this key may update feedback state or run callbacks. */
	latestKey?: string | symbol;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readRecordString(record: Record<string, unknown>, key: string): string | null {
	return readString(record[key]);
}

function resolveResultErrorMessage(result: unknown): string {
	if (isRecord(result)) {
		return readRecordString(result, 'error')
			?? readRecordString(result, 'message')
			?? 'Request failed';
	}

	return 'Request failed';
}

function isDefaultSuccess(result: unknown): boolean {
	if (result === null || result === undefined || result === false)
		return false;

	return !(isRecord(result) && result.success === false);
}

function resolveToast<TPayload>(
	option: ToastResolver<TPayload> | undefined,
	payload: TPayload,
): ToastOptions | null {
	if (option === false)
		return null;

	if (typeof option === 'function') {
		const resolved = option(payload);
		return resolved === false ? null : resolved ?? null;
	}

	return option ?? null;
}

export function useRequestFeedback() {
	const toast = useToast();
	const requests = createKeyedGuardedSequence<string | symbol>();

	function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
		if (typeof error === 'string' && error.trim().length > 0)
			return error;

		if (!isRecord(error))
			return fallback;

		const data = error.data;
		if (isRecord(data)) {
			const dataMessage = readRecordString(data, 'message')
				?? readRecordString(data, 'statusMessage')
				?? readRecordString(data, 'error');
			if (dataMessage)
				return dataMessage;
		}

		return readRecordString(error, 'statusMessage')
			?? readRecordString(error, 'message')
			?? fallback;
	}

	async function runRequest<T>(
		action: () => Promise<T>,
		options: RunRequestOptions<T> = {},
	): Promise<SuccessfulResult<T> | null> {
		const {
			loadingRef,
			errorRef,
			success,
			error,
			onSuccess,
			onFailure,
			isSuccess,
			latestKey,
		} = options;
		const flight = latestKey === undefined ? unguarded : requests.begin(latestKey);

		if (loadingRef)
			loadingRef.value = true;
		if (errorRef)
			errorRef.value = null;

		try {
			const result = await action();
			if (flight.stale)
				return null;
			const succeeded = isSuccess ? isSuccess(result) : isDefaultSuccess(result);

			if (!succeeded) {
				const failure = {
					message: resolveResultErrorMessage(result),
					result,
				};
				if (errorRef)
					errorRef.value = failure.message;
				await onFailure?.(failure);

				const toastOptions = resolveToast(error, failure)
					?? (error === undefined
						? { title: 'Error', description: failure.message, color: 'error' as const }
						: null);
				if (toastOptions)
					toast.add(toastOptions);

				return null;
			}

			const successfulResult = result as SuccessfulResult<T>;
			await onSuccess?.(successfulResult);
			const toastOptions = resolveToast(success, successfulResult);
			if (toastOptions)
				toast.add(toastOptions);

			return successfulResult;
		}
		catch (caughtError) {
			if (flight.stale)
				return null;
			const failure = {
				message: getErrorMessage(caughtError),
				error: caughtError,
			};
			if (errorRef)
				errorRef.value = failure.message;
			await onFailure?.(failure);

			const toastOptions = resolveToast(error, failure)
				?? (error === undefined
					? { title: 'Error', description: failure.message, color: 'error' as const }
					: null);
			if (toastOptions)
				toast.add(toastOptions);

			return null;
		}
		finally {
			if (loadingRef && flight.current)
				loadingRef.value = false;
		}
	}

	return {
		runRequest,
		getErrorMessage,
	};
}
