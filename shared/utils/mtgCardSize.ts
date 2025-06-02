export function mtgCardSize(cardWidth: number, aspectRatio = 85 / 61) {
  const cardHeight = cardWidth * aspectRatio
  const diagonal = Math.sqrt(cardWidth ** 2 + cardHeight ** 2)

  // Required margins to center the card in the rotated container
  const marginHorizontal = (diagonal - cardWidth) / 2
  const marginVertical = (diagonal - cardHeight) / 2

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
  }
}
