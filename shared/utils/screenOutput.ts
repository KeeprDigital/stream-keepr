import type { ScreenOutput } from '../types/screenConfig';

export const SCREEN_OUTPUT_VALUES: ScreenOutput[] = ['overlay', 'fill', 'key'];

/**
 * Why a control surface embedded this Screen Output, when one did.
 *
 * A Screen URL without a role opens a Screen Output: it joins its Screen's presence,
 * answers that Screen's commands, and is one of the outputs every presence-derived
 * surface counts. A role says the opposite — that a control surface put this here for
 * its own operator to look at — and which of the two kinds it put here.
 *
 * One selection rather than a pile of opt-outs, so the two kinds cannot be asked for
 * at once. An editor preview that is also live playout is not a thing this
 * application has, and the query cannot spell one.
 */
export type ScreenEmbed = 'preview' | 'monitor';

export const SCREEN_EMBED_VALUES: ScreenEmbed[] = ['preview', 'monitor'];

/**
 * Resolve the embed role carried on a Screen's one stable URL, or null for the
 * Screen Output a URL without a readable role opens.
 *
 * An unrecognised role is no role, which is the reading that fails safe: a mistyped
 * URL opens something that reports itself to its Screen and is counted, rather than
 * something that watches invisibly while every surface stating what the outputs cost
 * is silently wrong about it.
 */
export function parseScreenEmbed(value: unknown): ScreenEmbed | null {
	const raw = Array.isArray(value) ? value[0] : value;
	return SCREEN_EMBED_VALUES.includes(raw as ScreenEmbed) ? raw as ScreenEmbed : null;
}

/**
 * Resolve the Screen Output selection carried on a Screen's one stable URL. An
 * omitted or invalid selection renders the Overlay Output.
 */
export function parseScreenOutput(value: unknown): { output: ScreenOutput; warning: string | null } {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw === undefined || raw === null || raw === '')
		return { output: 'overlay', warning: null };
	if (raw === 'overlay' || raw === 'fill' || raw === 'key')
		return { output: raw, warning: null };

	return { output: 'overlay', warning: `Invalid output mode "${String(raw)}"; rendering overlay.` };
}

/** The one black every Screen Output composes over when it is not transparent. */
export const SCREEN_OUTPUT_BLACK = '#000000';

/**
 * Whether a Screen Output composes over black rather than transparency.
 *
 * The single source of this rule: an empty Screen is transparent in its Overlay
 * Output and black in its Fill Output and Key Output. The live composed canvas
 * and the PNG capture both derive from here so a capture can never diverge from
 * the output it captures.
 */
export function screenOutputCompositesOverBlack(output: ScreenOutput): boolean {
	return output !== 'overlay';
}

/** The CSS background of the composed canvas for a Screen Output. */
export function screenOutputCanvasBackground(output: ScreenOutput): string {
	return screenOutputCompositesOverBlack(output) ? SCREEN_OUTPUT_BLACK : 'transparent';
}

/** The capture background for a Screen Output; omitted for the transparent Overlay Output. */
export function screenOutputBackground(output: ScreenOutput): string | undefined {
	return screenOutputCompositesOverBlack(output) ? SCREEN_OUTPUT_BLACK : undefined;
}

export interface ScreenOutputPathOptions {
	eventId: number;
	screenSlug: string;
	/** Omitted renders the Overlay Output. */
	output?: ScreenOutput;
	/**
	 * Mark this as embedded by a control surface, and say as which kind.
	 *
	 * `preview` is the editor's rendering of authored state: it composes the stack its
	 * embedder pushes in rather than playout, resolves media as the author rather than
	 * through a Screen Output Asset Capability, and may draw editor-only guides and
	 * the Feature Match Sample Dataset. `monitor` is live in every one of those ways
	 * and differs from an output in one: it is what the operator running the Screen is
	 * looking at, so it joins no presence and answers no Screen command.
	 *
	 * Neither is set by the copyable broadcast URLs or the PNG capture URL, so no URL
	 * this application hands an operator can be either. What that does and does not
	 * guarantee is worked out over the guide flags in
	 * `app/modules/screen/displaySession.ts`, which is the one place it is written
	 * down (issue #134).
	 */
	embed?: ScreenEmbed;
	itemGuides?: boolean;
	safeAreaGuides?: boolean;
	/** Capture the output as a PNG from a temporary tab. */
	download?: boolean;
	/**
	 * The Screen Output Asset Capability this output resolves its Graphic Asset
	 * Revisions with. Without one, an output that is not an editor preview renders
	 * no media at all: it has no other route to the bytes, by design.
	 *
	 * Carried in the URL fragment rather than the query, so it is never sent to the
	 * server as part of the navigation and stays out of request logs.
	 */
	assetCapability?: string | null;
}

/**
 * The one stable Screen URL for a Screen Output, with its output selection, any
 * embed role and preview flags, and any asset capability. Built here so every
 * embedder agrees on the query — and so an embedder cannot forget the capability its
 * output needs to show media.
 *
 * Deliberately carries no scaling flag. Uniform viewport-fit scaling is registered
 * by the Screen Mode Definition and applies to every output of a mode that
 * registers it; it was a URL option only for as long as it took someone to open an
 * output the editor had not built the URL for (#232).
 */
/**
 * The shape a capability has to be to be one, matching the server's own
 * `bearerScreenOutputCapability`.
 *
 * A value that cannot be a capability is treated as no capability rather than
 * presented and refused, so a mistyped fragment renders an output without media
 * instead of one that fails its bootstrap.
 */
const ASSET_CAPABILITY = /^[\w-]{20,200}$/;

/**
 * Read the Screen Output Asset Capability back out of a URL fragment — the
 * inverse of the fragment `screenOutputPath` writes.
 *
 * Here rather than in the one page that used to parse it, because #397 gave the
 * capability two more readers: the realtime plugin presents it to
 * `/api/realtime/token` for its narrowed grant, and the Screen lookup by slug
 * presents it as the credential that route now requires. Three parsers for one
 * encoding is how a fragment written in one place stops being readable in
 * another; this file already owns writing it, so it owns reading it.
 */
export function screenOutputAssetCapabilityFromHash(hash: string): string | null {
	const value = new URLSearchParams(hash.replace(/^#/, '')).get('asset-capability');
	return value && ASSET_CAPABILITY.test(value) ? value : null;
}

export function screenOutputPath(options: ScreenOutputPathOptions): string {
	const query = new URLSearchParams({ output: options.output ?? 'overlay' });
	if (options.embed)
		query.set('embed', options.embed);
	if (options.itemGuides)
		query.set('guides', '1');
	if (options.safeAreaGuides)
		query.set('safe', '1');
	if (options.download)
		query.set('download', '1');

	const fragment = options.assetCapability
		? `#asset-capability=${encodeURIComponent(options.assetCapability)}`
		: '';

	return `/event/${options.eventId}/screen/${options.screenSlug}?${query.toString()}${fragment}`;
}
