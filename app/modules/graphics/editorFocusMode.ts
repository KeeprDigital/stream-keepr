import type { ComputedRef, WritableComputedRef } from 'vue';
import { computed, onScopeDispose, shallowRef } from 'vue';

const STORAGE_KEY = 'editor-focusMode';

/**
 * Editor Focus Mode: the graphics editors' Edit workspaces given the page's
 * width and height by hiding the chrome around them (#744).
 *
 * One setting per browser, shared by the Feature Match Overlay editor and the
 * Broadcast Graphics Edit workspace. It is held here for the document and
 * written through to storage, so a browser that refuses storage still toggles
 * it for this visit and only forgets it on reload. Not `useLocalStorage`, as
 * `useGeometryUnit` is: its refused-storage fallback is a ref per caller, and
 * the page and the editor reading two refs would disagree about the chrome.
 */
const enabledSetting = shallowRef<boolean | null>(null);

/** How many open editors Focus Mode applies to; the page's chrome yields only while one is. */
const openHosts = shallowRef(0);

function readStored(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) === 'on';
	}
	catch {
		return false;
	}
}

function writeStored(enabled: boolean) {
	try {
		if (enabled)
			localStorage.setItem(STORAGE_KEY, 'on');
		else
			localStorage.removeItem(STORAGE_KEY);
	}
	catch {
		// Remembered for this visit only.
	}
}

export interface EditorFocusMode {
	/** The browser's remembered choice, whether or not an editor is open for it to apply to. */
	enabled: WritableComputedRef<boolean>;
	/** Whether the page is in Focus Mode now: chosen, and an editor it applies to is open. */
	active: ComputedRef<boolean>;
	toggle: () => void;
}

export function useEditorFocusMode(): EditorFocusMode {
	// Read on first use rather than at import, so the module loads anywhere.
	if (enabledSetting.value === null)
		enabledSetting.value = readStored();

	const enabled = computed<boolean>({
		get: () => enabledSetting.value === true,
		set: (next) => {
			enabledSetting.value = next;
			writeStored(next);
		},
	});

	return {
		enabled,
		active: computed(() => enabled.value && openHosts.value > 0),
		toggle: () => {
			enabled.value = !enabled.value;
		},
	};
}

/**
 * Declares an editor Focus Mode applies to, for the lifetime of the calling
 * scope. Its toggle calls this, so Focus Mode is never active where nothing
 * offers the way out of it: Escape belongs to the editors' own interactions.
 */
export function useEditorFocusModeHost(): EditorFocusMode {
	openHosts.value += 1;
	onScopeDispose(() => {
		openHosts.value -= 1;
	});
	return useEditorFocusMode();
}
