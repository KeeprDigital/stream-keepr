import type { GraphicsCanonicalCapacityPressure } from '~~/shared/types/graphicsAsset';

export function graphicsCanonicalCapacityPressure(
	usedBytes: number,
	limitBytes: number,
): GraphicsCanonicalCapacityPressure {
	const ratio = usedBytes / limitBytes;
	if (ratio >= 1)
		return 'full';
	if (ratio >= 0.95)
		return 'critical';
	if (ratio >= 0.8)
		return 'warning';
	return 'normal';
}
