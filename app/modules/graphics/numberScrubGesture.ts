import type { InjectionKey } from 'vue';

/**
 * What an editor does around one drag on a number field's label, so its writes
 * are one undo step: `begin` when the drag first changes the value, `end` when
 * the pointer lets go. An editor without undo provides nothing, and each step is
 * an ordinary edit.
 */
export interface NumberScrubGesture {
	begin: () => void;
	end: () => void;
}

export const NUMBER_SCRUB_GESTURE: InjectionKey<NumberScrubGesture> = Symbol('number-scrub-gesture');
