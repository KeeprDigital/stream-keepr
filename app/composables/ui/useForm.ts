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
	 * Get only the fields that have changed (for PATCH requests)
	 * Returns DeepPartial<T> with only modified fields
	 */
	getChanges: () => DeepPartial<T>;
	/**
	 * Run a save and settle the form on what it stored. Once the save resolves
	 * truthy, every value still as it was submitted takes the baseline's, so a
	 * value the save normalized (trimmed, blank read as null) stops counting as
	 * a change, while one edited since the submit stays. The save must have
	 * moved the `initialData` ref to its answer by the time it resolves; a
	 * failed save (falsy), or one that never reached the baseline, leaves the
	 * form as it is.
	 */
	runSave: <R>(save: () => Promise<R>) => Promise<R>;
}

/**
 * Composable for managing form state, reset functionality, and change tracking
 *
 * Provides form data tracking, dirty state detection, reset capabilities,
 * and extraction of changed fields for PATCH requests.
 * Automatically watches for changes to initial data if provided as a ref, and
 * merges each new baseline into the form: fields the operator has not edited
 * follow it, edited ones keep the local value (#612). Submit `getChanges()`,
 * not the whole form, so untouched fields are never written back, and wrap
 * the save in `runSave` so a value the save normalized reads clean after it.
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
			Object.entries(data).map(([key, value]) => [
				key,
				cloneData(value),
			]),
		) as D;
	};

	const getInitialValue = (): T => {
		return isRef(initialData)
			? cloneData(initialData.value)
			: cloneData(initialData);
	};

	const formData = ref<T>(getInitialValue()) as Ref<T>;
	const originalFormData = ref<T>(getInitialValue()) as Ref<T>;

	const isPlainObject = (value: unknown): value is Record<string, unknown> => {
		return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
	};

	/**
	 * Serializes with object keys sorted: a merge appends keys the new baseline
	 * added, so the same values can arrive in another key order and must still
	 * compare equal.
	 */
	const serialize = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) =>
		isPlainObject(entry)
			? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]))
			: entry);

	const isDirty = computed(() => {
		return serialize(formData.value) !== serialize(originalFormData.value);
	});

	const areValuesEqual = (val1: unknown, val2: unknown): boolean => {
		if (val1 === val2)
			return true;

		if (val1 instanceof Date && val2 instanceof Date) {
			return val1.getTime() === val2.getTime();
		}

		if (Array.isArray(val1) && Array.isArray(val2)) {
			return serialize(val1) === serialize(val2);
		}

		if (typeof val1 === 'object' && val1 !== null && typeof val2 === 'object' && val2 !== null) {
			return serialize(val1) === serialize(val2);
		}

		return false;
	};

	const hasRowId = (value: unknown): value is Record<string, unknown> => {
		return isPlainObject(value) && value.id !== undefined && value.id !== null;
	};

	const isRowList = (value: unknown): value is Record<string, unknown>[] => {
		return Array.isArray(value) && value.every(hasRowId);
	};

	/**
	 * Merges a list of rows by `id`. A row the operator added (no id), removed or
	 * edited stays as they left it, an edited row the remote side removed among
	 * them; a row they left untouched follows the remote side, as do rows the
	 * remote side added.
	 */
	function mergeRows(local: unknown[], previous: Record<string, unknown>[], next: Record<string, unknown>[]): unknown[] {
		const previousById = new Map(previous.map(row => [row.id, row]));
		const nextById = new Map(next.map(row => [row.id, row]));
		const localIds = new Set<unknown>();
		const merged: unknown[] = [];

		for (const row of local) {
			if (!hasRowId(row)) {
				merged.push(row);
				continue;
			}

			localIds.add(row.id);
			const before = previousById.get(row.id);
			const after = nextById.get(row.id);
			if (before && !after) {
				if (!areValuesEqual(row, before))
					merged.push(row);
			}
			else {
				merged.push(before && after
					? mergeValue(row, before, after)
					: row);
			}
		}

		for (const row of next) {
			if (!previousById.has(row.id) && !localIds.has(row.id))
				merged.push(cloneData(row));
		}

		return merged;
	}

	/**
	 * Three-way merge of a new baseline into the form (#612).
	 *
	 * A value the operator left as the previous baseline had it takes the new
	 * baseline's. A value they edited keeps theirs: on a same-field conflict the
	 * local edit wins and stays a change against the new baseline, unless the
	 * remote value now matches it. Plain objects merge per key and lists of rows
	 * carrying an `id` per row; other arrays and values are atomic.
	 */
	function mergeValue(local: unknown, previous: unknown, next: unknown): unknown {
		if (areValuesEqual(local, previous))
			return cloneData(next);

		if (Array.isArray(local) && local.every(isPlainObject) && isRowList(previous) && isRowList(next))
			return mergeRows(local, previous, next);

		if (!isPlainObject(local) || !isPlainObject(previous) || !isPlainObject(next))
			return local;

		const merged: Record<string, unknown> = {};
		for (const key of new Set([
			...Object.keys(local),
			...Object.keys(next),
		])) {
			const value = mergeValue(local[key], previous[key], next[key]);
			if (value !== undefined || Object.hasOwn(next, key))
				merged[key] = value;
		}
		return merged;
	}

	/** Counts baselines merged in, so a save can tell whether its answer arrived. */
	let baselineVersion = 0;

	if (isRef(initialData)) {
		watch(initialData, (newData) => {
			baselineVersion++;
			const next = cloneData(newData);
			formData.value = mergeValue(formData.value, originalFormData.value, next) as T;
			originalFormData.value = cloneData(next);
		}, { deep: true });
	}

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

	const runSave = async <R>(save: () => Promise<R>): Promise<R> => {
		const submitted = cloneData(formData.value);
		const submittedVersion = baselineVersion;
		const result = await save();
		if (!result || !isRef(initialData))
			return result;
		// The watcher merges the answer into the baseline on the next flush.
		await nextTick();
		if (baselineVersion !== submittedVersion)
			formData.value = mergeValue(formData.value, submitted, cloneData(originalFormData.value)) as T;
		return result;
	};

	return {
		formData,
		originalFormData,
		isDirty,
		reset,
		getChanges,
		runSave,
	};
}
