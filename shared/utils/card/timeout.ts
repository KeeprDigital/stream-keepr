import type { MtgCardTimeoutData } from '~~/shared/types/card/mtg';

/**
 * How long a Screen Card has left at `now` (server time), by its Card Timeout:
 * `Infinity` for an untimed Card, zero or less once it has expired.
 *
 * Expiry is a clock projection (ADR-0022). The Card read and every holder derive
 * it from this one rule, so the server's `null` and a client's hiding agree.
 */
export function cardTimeoutRemainingMs(timeoutData: MtgCardTimeoutData | undefined, now: number): number {
	if (!timeoutData)
		return Infinity;
	return timeoutData.timeoutStartTimestamp + timeoutData.timeoutDuration - now;
}
