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

/**
 * What a paginated Screen Mode Definition declares about its Page Rotation
 * (`pageRotation` in `shared/screenModes.ts`): the config field holding how
 * many rows a page holds. The rotation's own fields are the shared
 * `pageRotationShape`, which every declaring mode's config carries.
 */
export interface PageRotationDeclaration {
	readonly pageSize: string;
}

/**
 * How many rows a page holds in a paginated mode's config, read from the field
 * its declaration names. The Screen Mode Definitions fail to compile unless
 * that field is a number.
 */
export function rotationPageSize(declaration: PageRotationDeclaration, config: object): number {
	return (config as Record<string, unknown>)[declaration.pageSize] as number;
}

/** The config fields whose edit changes a Page Rotation's shape: how many rows a page holds, and how long it shows. */
export function pageRotationShapeFields(declaration: PageRotationDeclaration): readonly string[] {
	return [declaration.pageSize, 'autoPageIntervalMs'];
}

/**
 * The write an operator edit of a paginated mode's config makes. An edit that
 * changes the rotation's shape restarts it from page 1: the manually selected
 * page goes back to 1 and, while auto-page is on, the Rotation Anchor moves to
 * now. Any other edit is written as it is; nothing else re-anchors (ADR-0009).
 *
 * The one place that decides which edits are shape changes, for every mode
 * declaring a Page Rotation.
 */
export function pageRotationEdit<Patch extends Record<string, unknown>>(
	declaration: PageRotationDeclaration,
	rotation: { autoPageEnabled: boolean; autoPageIntervalMs: number },
	patch: Patch,
	now: number,
): Patch & { currentPage?: number; rotationAnchor?: number } {
	if (!pageRotationShapeFields(declaration).some(field => field in patch))
		return patch;
	const restarted = { ...patch, currentPage: 1 };
	return rotation.autoPageEnabled
		? { ...restarted, rotationAnchor: rotationAnchorForPage({ page: 1, pageDurationMs: rotation.autoPageIntervalMs, now }) }
		: restarted;
}
