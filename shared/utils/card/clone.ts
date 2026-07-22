import type { MtgCard } from '~~/shared/types/card/mtg';

export function cloneMtgCard(card: MtgCard): MtgCard {
	return {
		id: card.id,
		name: card.name,
		set: card.set,
		layout: card.layout,
		imageData: {
			front: card.imageData.front ? { ...card.imageData.front } : null,
			back: card.imageData.back ? { ...card.imageData.back } : null,
		},
		orientationData: { ...card.orientationData },
		displayData: { ...card.displayData },
		meldData: card.meldData ? { ...card.meldData } : undefined,
		timeoutData: card.timeoutData ? { ...card.timeoutData } : undefined,
	};
}
