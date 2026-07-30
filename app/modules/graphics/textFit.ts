import type { GraphicTextShrinkBounds } from './renderModel';

/**
 * The search a `shrink` Text Overflow Policy runs: the largest whole font size
 * within the authored bounds whose rendered text still fits, falling back to
 * the author-set minimum where nothing fits so ellipsis clips the remainder.
 *
 * The search is pure; measurement is the caller's, so the same rule holds
 * whether it measures a real element or a stand-in.
 */
export function fitGraphicTextFontSize(
	bounds: GraphicTextShrinkBounds,
	fits: (fontSize: number) => boolean,
): number {
	const max = Math.max(0, Math.floor(bounds.maxFontSize));
	const min = Math.min(max, Math.max(0, Math.floor(bounds.minFontSize)));

	if (fits(max))
		return max;

	let low = min;
	let high = max;
	let best = min;

	while (low <= high) {
		const candidate = Math.floor((low + high) / 2);
		if (fits(candidate)) {
			best = candidate;
			low = candidate + 1;
		}
		else {
			high = candidate - 1;
		}
	}

	return best;
}
