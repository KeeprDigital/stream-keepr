/**
 * Page Rotation — the deterministic projection of a paginated Screen Mode's
 * current page from its Rotation Anchor and server time.
 *
 * Owned by no client and computed identically by every rendering (Screen
 * Output, Program monitor, operator settings), the same discipline the
 * broadcast-graphics phase projection follows: current state is a pure
 * function of persisted state and the synchronized server instant, so
 * renderings agree by construction and nothing writes as the rotation runs.
 */

export interface PageRotationInputs {
	/**
	 * The server timestamp the rotation counts from. A missing anchor projects
	 * from epoch zero — still deterministic and identical across renderings —
	 * so configs written before the anchor existed rotate without migration.
	 */
	rotationAnchor?: number;
	pageDurationMs: number;
	totalPages: number;
	/** The current synchronized server instant (never a raw local clock). */
	now: number;
}

/** The 1-based page a Page Rotation shows at the given instant. */
export function projectRotationPage(inputs: PageRotationInputs): number {
	if (inputs.totalPages <= 1 || inputs.pageDurationMs <= 0)
		return 1;
	const elapsed = Math.max(0, inputs.now - (inputs.rotationAnchor ?? 0));
	return (Math.floor(elapsed / inputs.pageDurationMs) % inputs.totalPages) + 1;
}

/**
 * The Rotation Anchor an operator surface writes when a page is manually
 * selected mid-rotation: the chosen page becomes current immediately and
 * holds for one full page duration before rotation continues in order.
 *
 * Rounded, because the synchronized clock estimate is an RTT-averaged float
 * while a stored anchor is an integer timestamp.
 */
export function rotationAnchorForPage(inputs: { page: number; pageDurationMs: number; now: number }): number {
	return Math.round(inputs.now - (inputs.page - 1) * inputs.pageDurationMs);
}

/**
 * Milliseconds until the projection next changes page, or null when nothing
 * rotates. A rendering schedules exactly one re-evaluation at this boundary
 * instead of polling.
 */
export function msUntilNextRotationFlip(inputs: PageRotationInputs): number | null {
	if (inputs.totalPages <= 1 || inputs.pageDurationMs <= 0)
		return null;
	const elapsed = inputs.now - (inputs.rotationAnchor ?? 0);
	if (elapsed < 0)
		return -elapsed + inputs.pageDurationMs;
	return inputs.pageDurationMs - (elapsed % inputs.pageDurationMs);
}
