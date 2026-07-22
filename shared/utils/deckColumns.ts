export type DeckColumnGroup<T> = readonly [string, T[]];

const DEFAULT_COLUMN_GAP = 24;
const DEFAULT_GROUP_HEADER_WEIGHT = 1;

function getDefaultGroupWeight<T>(group: DeckColumnGroup<T>) {
	return group[1].length + DEFAULT_GROUP_HEADER_WEIGHT;
}

function getColumnHeight(prefixSums: number[], start: number, end: number) {
	return (prefixSums[end] ?? 0) - (prefixSums[start] ?? 0);
}

function buildColumns<T>(groups: DeckColumnGroup<T>[], splitPoints: number[]) {
	const columns: DeckColumnGroup<T>[][] = [];
	let start = 0;

	for (const end of splitPoints) {
		columns.push(groups.slice(start, end));
		start = end;
	}

	return columns;
}

/**
 * Split ordered deck groups into contiguous columns while keeping the original
 * type order. This recreates the old CSS-column look without browser-specific
 * layout behavior.
 */
export function splitDeckGroupsIntoColumns<T>(
	groupsInput: Iterable<DeckColumnGroup<T>>,
	columnCount: number,
	getGroupWeight: (group: DeckColumnGroup<T>) => number = getDefaultGroupWeight,
): DeckColumnGroup<T>[][] {
	const groups = [...groupsInput];
	if (groups.length === 0) {
		return [];
	}

	const safeColumnCount = Math.max(1, Math.min(Math.floor(columnCount), groups.length));
	if (safeColumnCount === 1) {
		return [groups];
	}

	const prefixSums = [0];
	for (const group of groups) {
		const previousSum = prefixSums[prefixSums.length - 1] ?? 0;
		prefixSums.push(previousSum + getGroupWeight(group));
	}

	let bestSplitPoints: number[] | null = null;
	let bestScore: [number, number, number] | null = null;

	function evaluate(splitPoints: number[]) {
		const columnHeights = splitPoints.map((end, index) => {
			const start = index === 0 ? 0 : (splitPoints[index - 1] ?? 0);
			return getColumnHeight(prefixSums, start, end);
		});

		const maxHeight = Math.max(...columnHeights);
		const minHeight = Math.min(...columnHeights);
		const imbalance = columnHeights.reduce((sum, height) => sum + Math.abs(maxHeight - height), 0);
		const score: [number, number, number] = [maxHeight, maxHeight - minHeight, imbalance];

		if (
			bestScore == null
			|| score[0] < bestScore[0]
			|| (score[0] === bestScore[0] && score[1] < bestScore[1])
			|| (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2])
		) {
			bestScore = score;
			bestSplitPoints = [...splitPoints];
		}
	}

	function search(start: number, remainingColumns: number, splitPoints: number[]) {
		if (remainingColumns === 1) {
			evaluate([...splitPoints, groups.length]);
			return;
		}

		const maxEnd = groups.length - (remainingColumns - 1);
		for (let end = start + 1; end <= maxEnd; end++) {
			search(end, remainingColumns - 1, [...splitPoints, end]);
		}
	}

	search(0, safeColumnCount, []);

	return buildColumns(groups, bestSplitPoints ?? [groups.length]);
}

export function getDeckColumnCount(
	containerWidth: number,
	minColumnWidth: number,
	columnGap: number = DEFAULT_COLUMN_GAP,
	maxColumns: number = Number.POSITIVE_INFINITY,
) {
	if (containerWidth <= 0 || minColumnWidth <= 0) {
		return 1;
	}

	const fittedColumns = Math.floor((containerWidth + columnGap) / (minColumnWidth + columnGap));
	return Math.max(1, Math.min(maxColumns, fittedColumns || 1));
}
