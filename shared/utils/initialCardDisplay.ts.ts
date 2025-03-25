export function initialCardDisplay(card?: CardData): CardDisplayData {
  const initialCardDisplay: CardDisplayData = {
    hidden: true,
    flipped: false,
    turnedOver: false,
    rotated: false,
    counterRotated: false,
  }

  if (!card) {
    return initialCardDisplay
  }

  if (card.orientationData.defaultRotated) {
    initialCardDisplay.rotated = true
  }

  return initialCardDisplay
}
