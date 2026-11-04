import type { DOMWrapper } from '@vue/test-utils';

/** A control inside `UIColorPicker`'s popover, by its `data-color-part`. */
export type ColorPickerPart = 'hue' | 'alpha' | 'alpha-percent' | 'text';

/** A mounted wrapper or one of its elements: anything a selector can be got within. */
interface Scope {
	get: (selector: string) => Omit<DOMWrapper<Element>, 'exists'>;
}

/**
 * Opens the `UIColorPicker` whose trigger `trigger` selects within `scope`,
 * makes one edit, and closes it again, which is when a `commit="close"` picker
 * emits. Mount with `nuxtUiStubs`, whose UPopover toggles on a trigger click.
 */
export async function editColorPicker(scope: Scope, trigger: string, part: ColorPickerPart, value: string | number) {
	await scope.get(trigger).trigger('click');
	await scope.get(`[data-color-part="${part}"]`).setValue(value);
	await scope.get(trigger).trigger('click');
}
