/**
 * What the Key matte rendering proof draws, and the floors each scene's
 * measurements are judged against. Shared by the page that draws and measures
 * (`key-matte-page.mjs`) and the Node half that judges (`key-matte-proof.mjs`).
 */

/** Every scene is drawn at this size, side by side in one row. */
export const KEY_MATTE_PROOF_SCENE = Object.freeze({ width: 240, height: 160 });

/**
 * One scene per glow host: a Graphic Item through the shared compositor, and the
 * Feature Match Overlay's host-owned Source Item and Frame. After them, the
 * planted control: a Source Item whose Key Output withholds its glow, as every
 * Feature Match Overlay Key Output did before #599. It must fail.
 */
export const KEY_MATTE_PROOF_HOSTS = Object.freeze(['graphic-item-glow', 'source-item-glow', 'frame-glow']);
export const KEY_MATTE_PROOF_CONTROL = 'unkeyed-glow-control';
export const KEY_MATTE_PROOF_SCENES = Object.freeze([...KEY_MATTE_PROOF_HOSTS, KEY_MATTE_PROOF_CONTROL]);

export const KEY_MATTE_PROOF_FLOORS = Object.freeze({
	/**
	 * The most a Key pixel's luminance may differ from the Overlay pixel's alpha,
	 * in 0–255 units. The Fill Output is the Overlay flattened over black, so this
	 * is the Key matte agreeing with what the Fill Output shows. A few units cover
	 * Chromium rounding white-at-alpha over black against an alpha channel; a glow
	 * missing from the Key Output misses by its whole peak, and one keyed opaque
	 * by the opacity it ignored.
	 */
	maxMatteError: 4,
	/**
	 * Partial grey pixels, neither black nor white, the Key Output must hold.
	 * Every scene's opaque paint sits on whole pixels, so grey comes from the
	 * glow alone: a glow missing from the Key Output leaves none. A Source Item's
	 * glow blurs a 4px border, so it is faint — its peak is a few percent — and
	 * the matte check, not this one, is what holds it to its own opacity.
	 */
	minGreyPixels: 400,
	/** A matte is grayscale: the most any Key pixel's channels may differ. */
	maxChroma: 2,
});
