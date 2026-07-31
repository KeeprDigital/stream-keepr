import type { GraphicsCanonicalCapacityPressure } from '~~/shared/types/graphicsAsset';

/**
 * The fractions of the Canonical Graphics Quota at which pressure changes.
 *
 * These are the boundaries the installation promises: a warning at 80%, a
 * critical warning at 95%, and net-new canonical publication blocked at 100%.
 * They are stated once here so the pressure a caller is told and the boundaries
 * an administrator is shown can never drift apart.
 */
export const GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS = {
	warning: 0.8,
	critical: 0.95,
	full: 1,
} as const;

export function graphicsCanonicalCapacityPressure(
	usedBytes: number,
	limitBytes: number,
): GraphicsCanonicalCapacityPressure {
	const ratio = usedBytes / limitBytes;
	if (ratio >= GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.full)
		return 'full';
	if (ratio >= GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.critical)
		return 'critical';
	if (ratio >= GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.warning)
		return 'warning';
	return 'normal';
}
