/**
 * The Animation Effect contract (ADR-0014): a live, autonomously animating
 * background renderer behind a host-agnostic surface. A host mounts one with a
 * factory, then owns the clock — it drives `render` with elapsed seconds from
 * its own animation frame loop — and the sizing, pushing viewport changes in
 * through `resize`. Effects animate from that elapsed time alone: there is no
 * pointer input and no synthetic drift, because the primary host is a headless
 * browser source nothing ever hovers.
 */
export interface AnimationEffectInstance<Params = unknown> {
	/** Apply changed params to the live effect, without rebuilding it. */
	setParams: (params: Params) => void;
	/** Adopt a new viewport size, in CSS pixels. */
	resize: (width: number, height: number) => void;
	/** Draw the frame for this many seconds since the effect was mounted. */
	render: (elapsedSeconds: number) => void;
	/** Release everything the effect created, including its canvas and GL context. */
	dispose: () => void;
}

export type AnimationEffectFactory<Params> = (host: HTMLElement, params: Params) => AnimationEffectInstance<Params>;
