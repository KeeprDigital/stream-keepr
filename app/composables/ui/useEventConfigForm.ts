import type { ComputedRef, Ref } from 'vue';
import type { UseFormReturn } from './useForm';
import type { UpdateEventInput } from '~/types';

type FormChanges<T extends Record<string, any>> = ReturnType<UseFormReturn<T>['getChanges']>;

export interface UseEventConfigFormOptions<T extends Record<string, any>> {
	/** The form's fields as the Event holds them; the Event's updates flow in through it. */
	initialData: ComputedRef<T>;
	/** Maps the changed fields to the Event update that saves them. */
	toUpdate: (changes: FormChanges<T>) => UpdateEventInput;
	/** Refuses the save when false, leaving the form to show why. */
	validate?: () => boolean;
	clearOnReset?: Ref<any>;
}

/**
 * An Event config card's form: tracks it against the Event, tells the page
 * while it is unsaved, and saves its changes as an Event update through
 * `runSave`, so a value the save normalized reads clean once it lands. One
 * save at a time: the Event store's update reports no loading of its own, and
 * Enter submits the form past a disabled Save.
 */
export function useEventConfigForm<T extends Record<string, any>>(options: UseEventConfigFormOptions<T>) {
	const { toUpdate, validate, ...formOptions } = options;
	const form = useForm<T>(formOptions);
	useRegisterDirtyState(form.isDirty);
	const { handleSubmit } = useEventConfigSubmit();
	const saving = ref(false);

	async function save() {
		if (saving.value || (validate && !validate()))
			return;
		saving.value = true;
		try {
			await form.runSave(() => handleSubmit(toUpdate(form.getChanges())));
		}
		finally {
			saving.value = false;
		}
	}

	return { ...form, saving, save };
}
