type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface UseFormOptions<T> {
	/**
	 * Initial data for the form
	 */
	initialData: T | Ref<T>;
	/**
	 * Optional ref to clear on reset (e.g., errors object)
	 */
	clearOnReset?: Ref<any>;
	/**
	 * Optional callback to run after reset
	 */
	onReset?: () => void;
}

export interface UseFormReturn<T> {
	/**
	 * Current form data (reactive)
	 */
	formData: Ref<T>;
	/**
	 * Original form data for comparison
	 */
	originalFormData: Ref<T>;
	/**
	 * Computed property indicating if form has unsaved changes
	 */
	isDirty: ComputedRef<boolean>;
	/**
	 * Reset form to original state
	 */
	reset: () => void;
	/**
	 * Update the original data (useful when external data changes)
	 */
	updateOriginal: (data: T) => void;
	/**
	 * Get only the fields that have changed (for PATCH requests)
	 * Returns DeepPartial<T> with only modified fields
	 */
	getChanges: () => DeepPartial<T>;
}

/**
 * Composable for managing form state, reset functionality, and change tracking
 *
 * Provides form data tracking, dirty state detection, reset capabilities,
 * and extraction of changed fields for PATCH requests.
 * Automatically watches for changes to initial data if provided as a ref.
 *
 * @example
 * // Basic usage
 * const { formData, isDirty, reset } = useForm({
 *   initialData: { name: '', email: '' }
 * });
 *
 * @example
 * // With PATCH support
 * const { formData, isDirty, getChanges } = useForm({
 *   initialData: props.user
 * });
 *
 * formData.value.name = 'New Name';
 * const changes = getChanges(); // { name: 'New Name' }
 *
 * @example
 * // With error clearing
 * const errors = ref({});
 * const { formData, isDirty, reset } = useForm({
 *   initialData: props.user,
 *   clearOnReset: errors,
 *   onReset: () => console.log('Form reset!')
 * });
 */
export function useForm<T extends Record<string, any>>(
	options: UseFormOptions<T>,
): UseFormReturn<T> {
	const {
		initialData,
		clearOnReset,
		onReset,
	} = options;

	const cloneData = <D>(data: D): D => {
		if (data === null || typeof data !== 'object') {
			return data;
		}

		if (data instanceof Date) {
			return new Date(data.getTime()) as D;
		}

		if (Array.isArray(data)) {
			return data.map(item => cloneData(item)) as D;
		}

		return Object.fromEntries(
			Object.entries(data).map(([key, value]) => [key, cloneData(value)]),
		) as D;
	};

	const getInitialValue = (): T => {
		return isRef(initialData) ? cloneData(initialData.value) : cloneData(initialData);
	};

	const formData = ref<T>(getInitialValue()) as Ref<T>;
	const originalFormData = ref<T>(getInitialValue()) as Ref<T>;

	const isDirty = computed(() => {
		return JSON.stringify(formData.value) !== JSON.stringify(originalFormData.value);
	});

	if (isRef(initialData)) {
		watch(initialData, (newData) => {
			const cloned = cloneData(newData);
			// Capture dirty state before updating original, otherwise the
			// comparison between stale formData and the new originalFormData
			// always evaluates to dirty and prevents syncing.
			const wasClean = !isDirty.value;
			originalFormData.value = cloneData(cloned);
			// Only sync form data if the user hasn't made edits
			if (wasClean) {
				formData.value = cloned;
			}
		}, { deep: true });
	}

	const areValuesEqual = (val1: unknown, val2: unknown): boolean => {
		if (val1 === val2)
			return true;

		if (val1 instanceof Date && val2 instanceof Date) {
			return val1.getTime() === val2.getTime();
		}

		if (Array.isArray(val1) && Array.isArray(val2)) {
			return JSON.stringify(val1) === JSON.stringify(val2);
		}

		if (typeof val1 === 'object' && val1 !== null && typeof val2 === 'object' && val2 !== null) {
			return JSON.stringify(val1) === JSON.stringify(val2);
		}

		return false;
	};

	const getChanges = (): DeepPartial<T> => {
		const current = formData.value as Record<string, unknown>;
		const original = originalFormData.value as Record<string, unknown>;
		const changes: Record<string, unknown> = {};

		for (const key in current) {
			if (!Object.hasOwn(current, key))
				continue;

			if (!areValuesEqual(current[key], original?.[key])) {
				changes[key] = current[key];
			}
		}

		return changes as DeepPartial<T>;
	};

	const reset = () => {
		formData.value = cloneData(originalFormData.value);

		if (clearOnReset) {
			if (Array.isArray(clearOnReset.value)) {
				clearOnReset.value = [];
			}
			else if (typeof clearOnReset.value === 'object' && clearOnReset.value !== null) {
				clearOnReset.value = {};
			}
			else {
				clearOnReset.value = undefined;
			}
		}

		onReset?.();
	};

	const updateOriginal = (data: T) => {
		const cloned = cloneData(data);
		formData.value = cloned;
		originalFormData.value = cloneData(cloned);
	};

	return {
		formData,
		originalFormData,
		isDirty,
		reset,
		updateOriginal,
		getChanges,
	};
}
