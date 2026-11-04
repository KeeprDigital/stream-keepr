import type { NinePoint } from '~~/shared/utils/ninePoints';

/**
 * A badge in the centre of a card would cover its art, so a card badge's
 * position picker offers every point but this one, which is why what it emits
 * is always a `QuantityPosition`.
 */
export const BADGE_DISABLED_POINTS: readonly NinePoint[] = ['center'];
