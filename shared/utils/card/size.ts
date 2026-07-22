export function mtgCardSize(cardWidth: number, aspectRatio = 85 / 61) {
	const cardHeight = cardWidth * aspectRatio;
	const diagonal = Math.sqrt(cardWidth ** 2 + cardHeight ** 2);

	// Required margins to center the card in the rotated container
	const marginHorizontal = (diagonal - cardWidth) / 2;
	const marginVertical = (diagonal - cardHeight) / 2;

	return {
		// Minimum container dimensions
		minWidth: diagonal,
		minHeight: diagonal,

		// Original card dimensions
		cardWidth,
		cardHeight,
		diagonal,

		// Required margins
		marginHorizontal,
		marginVertical,

		// Total space occupied (should equal diagonal)
		totalWidth: cardWidth + (2 * marginHorizontal),
		totalHeight: cardHeight + (2 * marginVertical),
	};
}

/**
 * Calculate the optimal card width given available height
 * Accounts for the diagonal space needed when card is rotated PLUS margin
 */
export function mtgCardWidthFromHeight(
	availableHeight: number,
	aspectRatio = 85 / 61,
	margin = 40,
) {
	// The diagonal (container size) needs to fit within (availableHeight - margin)
	// So: diagonal <= availableHeight - margin
	const maxDiagonal = availableHeight - margin;

	// For a rotated card:
	// diagonal = sqrt(width^2 + height^2)
	// height = width * aspectRatio
	// diagonal = sqrt(width^2 + (width * aspectRatio)^2) = width * sqrt(1 + aspectRatio^2)
	// Solve for width: width = diagonal / sqrt(1 + aspectRatio^2)
	const cardWidth = maxDiagonal / Math.sqrt(1 + aspectRatio ** 2);

	// Clamp to maximum size only (no minimum, let it scale down)
	return Math.min(cardWidth, 800);
}

/**
 * Calculate all card dimensions from available window height
 * Combines mtgCardWidthFromHeight and mtgCardSize into a single calculation
 */
export function mtgCardSizeFromHeight(
	availableHeight: number,
	aspectRatio = 85 / 61,
	margin = 80,
) {
	// Calculate optimal card width
	const cardWidth = mtgCardWidthFromHeight(availableHeight, aspectRatio, margin);

	// Calculate all dimensions based on that width
	return mtgCardSize(cardWidth, aspectRatio);
}
