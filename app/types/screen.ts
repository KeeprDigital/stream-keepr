import type { ScreenCommand, ScreenMode } from '~~/shared/types/enums';

// Re-export ScreenMode for use in components
export type { ScreenMode };
export type { ScreenCommand };

/**
 * Whether a Screen Output's rendering resolved all the card data it asked for.
 *
 * `degraded` means the output is on program rendering placeholder cards it
 * should not be: a Scryfall fetch exhausted its retries, and the rendering is
 * re-fetching on its own until the data resolves (#465).
 */
export type ScreenCardDataHealth = 'complete' | 'degraded';

// Presence data for screen clients
export interface ScreenPresenceData {
	screenId: number;
	connectedAt: number;
	userAgent?: string;
	outputMode?: 'overlay' | 'fill' | 'key';
	/**
	 * Whether this Screen Output arrived holding a Screen Output Asset Capability.
	 *
	 * Reported by the output about itself, exactly as its engine is: an output with
	 * no capability has no route to a Graphic Asset's bytes and renders every graphic
	 * the Screen publishes *except* its media — silently, and identically to a Screen
	 * that simply has no media on air. Saying so here is what lets a control surface
	 * state it before an operator discovers it on program (#231).
	 *
	 * Absent on an older output that predates this field, which is why it is optional
	 * and why a reader must not treat "not reported" as "absent".
	 */
	assetAccess?: 'granted' | 'absent';
	/**
	 * Whether this Screen Output's rendering resolved all the card data it asked
	 * for, reported by the output about itself like `assetAccess` — a degraded
	 * deck keeps rendering placeholders on program and re-fetches on its own, so
	 * only this report lets a control surface state it (#465).
	 *
	 * Optional for the same reason as `assetAccess`: an output that predates the
	 * field is silent about its card data, not degraded.
	 */
	cardData?: ScreenCardDataHealth;
}
