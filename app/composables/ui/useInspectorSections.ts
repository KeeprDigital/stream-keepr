import { useRememberedOpenState } from '~/composables/ui/useRememberedOpenState';

/** Versioned: a change to which sections start open takes a new key, so state remembered under the old defaults is not carried over. */
const INSPECTOR_SECTIONS_STORAGE_KEY = 'editor-inspectorSections:v2';

/**
 * Which property panel sections an author has opened or closed, remembered per
 * browser by section id rather than per item — so opening Text style once keeps
 * it open on every text item that follows, in either graphics editor.
 */
export function useInspectorSections() {
	return useRememberedOpenState(INSPECTOR_SECTIONS_STORAGE_KEY);
}
