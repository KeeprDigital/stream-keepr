import type { MtgCard } from '~~/shared/types/card/mtg';

export const defaultMtgCardData: Omit<MtgCard, 'id' | 'name' | 'set' | 'layout'> = {
	imageData: {
		front: null,
		back: null,
	},
	orientationData: {
		flipable: false,
		turnable: false,
		rotateable: false,
		counterRotateable: false,
	},
	displayData: {
		flipped: false,
		rotated: false,
		counterRotated: false,
		turnedOver: false,
	},
	deckCounterTypes: [],
	deckTokens: [],
};
