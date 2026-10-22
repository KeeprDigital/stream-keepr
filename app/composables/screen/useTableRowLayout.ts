import type { MaybeComputedElementRef } from '@vueuse/core';
import type { MaybeRefOrGetter } from 'vue';
import type { TableRowDensity } from '~/utils/tableRowLayout';
import { useElementSize } from '@vueuse/core';
import { computed, toValue } from 'vue';
import { tableRowLayout, tableRowLayoutStyle } from '~/utils/tableRowLayout';

interface TableRowLayoutOptions {
	density: TableRowDensity;
	/** Names the custom properties: `--<prefix>-row-height` and so on. */
	prefix: string;
	/** Rows a full page lays out. */
	rowCount: MaybeRefOrGetter<number>;
	/** Vertical page inset taken out of the measured height. */
	insetY?: MaybeRefOrGetter<number>;
}

/**
 * Sizes a paged table Display's rows to fill the measured `target`, as the
 * row custom properties its stylesheet reads (see `tableRowLayout`).
 */
export function useTableRowLayout(target: MaybeComputedElementRef, options: TableRowLayoutOptions) {
	const { height } = useElementSize(target);

	return computed(() => tableRowLayoutStyle(options.prefix, tableRowLayout({
		density: options.density,
		measuredHeight: height.value,
		rowCount: toValue(options.rowCount),
		insetY: toValue(options.insetY) ?? 0,
	})));
}
