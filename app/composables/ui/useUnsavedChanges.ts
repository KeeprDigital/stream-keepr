import type { ComputedRef, InjectionKey, Ref } from 'vue';
import { LazyUIUnsavedChangesModal } from '#components';

const UNSAVED_CHANGES_KEY: InjectionKey<{
	registerDirtyState: (dirty: Ref<boolean> | ComputedRef<boolean>) => () => void;
}> = Symbol('unsaved-changes');

interface UseUnsavedChangesReturn {
	isDirty: ComputedRef<boolean>;
	registerDirtyState: (dirty: Ref<boolean> | ComputedRef<boolean>) => () => void;
	bypassGuard: () => void;
}

/**
 * Page-level composable for managing unsaved changes navigation guards.
 *
 * Sets up:
 * - Vue Router onBeforeRouteLeave guard (shows confirmation modal)
 * - Browser beforeunload listener (shows native dialog)
 * - Provides registerDirtyState for child components via inject
 *
 * @example
 * // In page component
 * useUnsavedChanges();
 */
export function useUnsavedChanges(): UseUnsavedChangesReturn {
	const dirtyStates = ref<Set<Ref<boolean> | ComputedRef<boolean>>>(new Set());
	const shouldBypass = ref(false);

	const isDirty = computed(() =>
		[...dirtyStates.value].some(s => unref(s)),
	);

	const registerDirtyState = (dirty: Ref<boolean> | ComputedRef<boolean>) => {
		dirtyStates.value.add(dirty);
		return () => dirtyStates.value.delete(dirty);
	};

	// Vue Router guard
	const overlay = useOverlay();
	const confirmModal = overlay.create(LazyUIUnsavedChangesModal);

	onBeforeRouteLeave(async () => {
		if (shouldBypass.value || !isDirty.value) {
			return true;
		}

		const confirmed = await confirmModal.open({}).result;
		return confirmed === true;
	});

	// Browser beforeunload handler
	const handleBeforeUnload = (e: BeforeUnloadEvent) => {
		if (isDirty.value) {
			e.preventDefault();
			// Legacy browsers require returnValue
			e.returnValue = '';
			return '';
		}
	};

	onMounted(() => {
		window.addEventListener('beforeunload', handleBeforeUnload);
	});

	onUnmounted(() => {
		window.removeEventListener('beforeunload', handleBeforeUnload);
	});

	// Provide registration function for child components
	provide(UNSAVED_CHANGES_KEY, { registerDirtyState });

	const bypassGuard = () => {
		shouldBypass.value = true;
	};

	return { isDirty, registerDirtyState, bypassGuard };
}

/**
 * Component-level helper to register dirty state with parent page's guard.
 *
 * Automatically registers the dirty state with the parent page's unsaved changes guard
 * and unregisters on component unmount.
 *
 * @param dirty - A ref or computed ref indicating if the component has unsaved changes
 *
 * @example
 * // In form component
 * const { isDirty } = useForm({ initialData: ... });
 * useRegisterDirtyState(isDirty);
 */
export function useRegisterDirtyState(dirty: Ref<boolean> | ComputedRef<boolean>): void {
	const ctx = inject(UNSAVED_CHANGES_KEY, null);
	if (ctx) {
		const unregister = ctx.registerDirtyState(dirty);
		onUnmounted(unregister);
	}
}
