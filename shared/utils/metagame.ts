export function getFrontFaceCardType(cardType: string | null | undefined): string {
	return (cardType ?? '').split(' // ')[0]?.trim() ?? '';
}

export const CARD_TYPE_BUCKET_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'] as const;

export type CardTypeBucket = typeof CARD_TYPE_BUCKET_ORDER[number];

export function getCardTypeBucket(cardType: string | null | undefined): CardTypeBucket {
	const frontFaceType = getFrontFaceCardType(cardType);

	for (const bucket of CARD_TYPE_BUCKET_ORDER) {
		if (bucket === 'Other') {
			continue;
		}

		if (frontFaceType.includes(bucket)) {
			return bucket;
		}
	}

	return 'Other';
}

export function getCardTypeBucketOrder(cardType: string | null | undefined): number {
	return CARD_TYPE_BUCKET_ORDER.indexOf(getCardTypeBucket(cardType));
}

export function getCardTypeDisplayLabel(
	cardType: string | null | undefined,
	options: { nonbasicLandLabel?: boolean } = {},
): string {
	const bucket = getCardTypeBucket(cardType);
	if (bucket === 'Land' && options.nonbasicLandLabel) {
		return 'Nonbasic Land';
	}

	return bucket;
}

export function isLandCardType(cardType: string | null | undefined): boolean {
	return getFrontFaceCardType(cardType).toLowerCase().includes('land');
}

export function isBasicLandCardType(cardType: string | null | undefined): boolean {
	const frontFace = getFrontFaceCardType(cardType).toLowerCase();
	return frontFace.includes('basic') && frontFace.includes('land');
}

export function isMetagameAnalysisCard(cardType: string | null | undefined): boolean {
	return !isBasicLandCardType(cardType);
}
