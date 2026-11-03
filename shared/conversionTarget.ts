import type { MetagameConversionMetric } from './types/enums';
import { z } from 'zod';
import { METAGAME_CONVERSION_METRIC_VALUES } from './types/enums';

/**
 * An Event's Conversion Target (ADR-0061): the Top N placement or minimum
 * match-point total a Player in the Metagame scope must reach to count as
 * converted. The Metagame page, the Metagame Screen and Archetype Spotlight all
 * read the Event's one target.
 */
export interface ConversionTarget {
	conversionMetric: MetagameConversionMetric;
	conversionThreshold: number;
}

export const DEFAULT_CONVERSION_TARGET: ConversionTarget = {
	conversionMetric: 'topN',
	conversionThreshold: 8,
};

/** Top N is a placement, so at least 1; a minimum-points target admits 0. */
export const CONVERSION_THRESHOLD_BOUNDS: Record<MetagameConversionMetric, { min: number; max: number }> = {
	topN: { min: 1, max: 999 },
	minPoints: { min: 0, max: 999 },
};

/** The two fields travel together, the threshold bounded by its metric. */
export const conversionTargetShape = {
	conversionMetric: z.enum(METAGAME_CONVERSION_METRIC_VALUES),
	conversionThreshold: z.number().int().min(0).max(999),
};

export function isConversionTargetInBounds({ conversionMetric, conversionThreshold }: ConversionTarget): boolean {
	const { min, max } = CONVERSION_THRESHOLD_BOUNDS[conversionMetric];
	return conversionThreshold >= min && conversionThreshold <= max;
}

/** The Event's target as a read takes it; an Event context not yet loaded reads the default. */
export function eventConversionTarget(event: Partial<ConversionTarget> | null | undefined): ConversionTarget {
	return event?.conversionMetric != null && event.conversionThreshold != null
		? { conversionMetric: event.conversionMetric, conversionThreshold: event.conversionThreshold }
		: DEFAULT_CONVERSION_TARGET;
}

/** The target named as the Metagame page and Archetype Spotlight name it: "Top 8", "9+ pts". */
export function conversionTargetLabel({ conversionMetric, conversionThreshold }: ConversionTarget): string {
	return conversionMetric === 'topN'
		? `Top ${conversionThreshold}`
		: `${conversionThreshold}+ pts`;
}
