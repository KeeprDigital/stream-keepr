/**
 * What the Animation Effect rendering proof mounts, and the floors each mount
 * has to clear.
 *
 * One entry per catalogue effect, so the table is the coverage: every effect is
 * mounted at its schema defaults, and the named extremes beside it mount the
 * same effect at the ends of the ranges the editor offers — the parameter values
 * a shader is most likely to fall apart at, and the ones no other suite ever
 * feeds it. An effect the catalogue names and this table does not is a gap the
 * unit pin fails on (`test/unit/scripts/animationEffectProof.test.ts`) rather
 * than a silently unproven shader.
 *
 * The floors are floors, not measurements. Each one sits well below what the
 * effect actually renders on SwiftShader (the run every number quoted here comes
 * from is recorded on #499), because the question they answer is "did this shader draw the
 * effect at all", not "did it draw exactly what it drew last time" — a pixel
 * budget tight enough to pin an appearance would fail on every legitimate
 * design tweak, and the thing that must never pass is a black frame.
 *
 * Both sides of the run read this file: the bundled page mounts what it names,
 * and the Node harness judges the measurements against it without having to
 * trust anything the page says about what it was supposed to do.
 */

/**
 * The floors an effect clears unless it says otherwise, as fractions of the
 * frame:
 *
 * - `minLitFraction` — pixels bright enough to be the effect rather than the
 *   dark backdrop it is drawn over. One percent of the frame is 1,296 pixels at
 *   the size below: far above the black frame this exists to catch, and far
 *   below the sparsest effect in the catalogue (the measured floor is ember's,
 *   which draws about five times that at its defaults).
 * - `maxBrightFraction` — the ambient half of the same fact. Animation Effects
 *   sit behind broadcast graphics, so a frame that is mostly *bright* is a
 *   shader blowing out, not an effect (#473 caught exactly this in weave's first
 *   cut).
 * - `minChangedFraction` — pixels that differ between the two sampled frames.
 *   This is the check that a compiled, lit, *frozen* shader cannot pass.
 *
 * The first two ask different questions rather than dividing the frame in two,
 * and it is worth being plain about that because the shorthand "lit pixels over
 * a dark-majority frame" reads like a partition. "Lit" starts low, at the point
 * a pixel stops being the backdrop; "bright" starts high, at the point a pixel
 * would wash out a graphic in front of it. Everything between the two counts as
 * lit and not bright, so a frame of even mid-tone — waves at its defaults is one
 * — satisfies both floors honestly. What no frame can do is satisfy them while
 * black, and what nothing washed out can do is satisfy the second.
 */
export const ANIMATION_EFFECT_PROOF_FLOORS = Object.freeze({
	minLitFraction: 0.01,
	maxBrightFraction: 0.5,
	minChangedFraction: 0.02,
});

/**
 * What the page counts, in the terms the floors are expressed in.
 *
 * Every Animation Effect is drawn over a dark backdrop — `#111111` is the
 * catalogue's default background, luminance 17 — so "lit" starts far enough
 * above that to be the effect rather than the backdrop, and "bright" starts at
 * half-bright, where a pixel begins to compete with the graphics in front of it.
 * "Changed" is a per-channel difference between the two sampled frames big
 * enough not to be dithering.
 */
export const ANIMATION_EFFECT_PROOF_PIXELS = Object.freeze({
	litLuminance: 40,
	brightLuminance: 128,
	changedChannel: 6,
});

/**
 * The frame every scenario is measured in, and the two elapsed times it is
 * measured at. Small because SwiftShader draws it on the CPU; wide enough that a
 * sparse point field still lands hundreds of pixels. The times are seconds into
 * the effect's own clock, two seconds apart so a slow effect still moves.
 */
export const ANIMATION_EFFECT_PROOF_FRAME = Object.freeze({
	width: 480,
	height: 270,
	seconds: Object.freeze([1, 3]),
});

/**
 * Per-effect scenarios and the floors they are held to.
 *
 * `floors` on an effect override the shared floors for every one of its
 * scenarios; `floors` on a scenario override both. Every override carries the
 * reason it is not the default, because a lowered floor — or a raised ceiling,
 * which is the same loosening in the other direction, and is what the one
 * override in this table is — is a weakened check, and the next reader has to be
 * able to tell a measured exception from a threshold that was nudged until the
 * run went green.
 *
 * **Which end of a range an extreme takes.** Every scenario here has to clear
 * all three checks, so an extreme is taken at whichever end still draws and
 * still moves. That rules out a whole class of range ends, and the class is
 * larger than the two cases that provoked it — a reader comparing this table
 * against the schemas will find real ends that are absent on purpose:
 *
 * - **Every Speed minimum.** Eleven effects offer `speed` (or `waveSpeed`) down
 *   to `0`, which stops the clock. The frame is correct and the animation check
 *   cannot pass, by construction rather than by defect.
 * - **Amplitudes that scale the whole image to nothing**, such as shards at
 *   `intensity: 0`.
 * - **Offsets that carry the effect out of frame**, such as halo at
 *   `xOffset`/`yOffset` of ±1.
 * - **Two measured cases**: fog at the bottom of its Softness range is flat base
 *   colour by construction (the fbm's first octave is that amplitude), and
 *   ripple at the top of its Rotation range swings its orbiting lights clear of
 *   the frame for seconds at a time.
 *
 * None of these is a rendering defect, and none can be asserted about here: a
 * scenario asserting that an effect renders nothing would fail the day someone
 * brightened it. Proving what an effect does at those ends needs a per-scenario
 * expectation this table deliberately does not have — the gate exists to catch
 * black frames, and a floor of zero catches nothing.
 */
export const ANIMATION_EFFECT_PROOF_SCENARIOS = Object.freeze({
	caustics: {
		extremes: [
			{ name: 'max-intensity', params: { intensity: 2 } },
			{ name: 'min-zoom', params: { zoom: 0.5 } },
		],
	},
	cells: {
		extremes: [
			{ name: 'min-size', params: { size: 0.2 } },
			{ name: 'max-size', params: { size: 5 } },
		],
	},
	dots: {
		extremes: [
			{ name: 'dense-field', params: { spacing: 5, size: 0.5 } },
			{ name: 'lines-off', params: { showLines: false, size: 20 } },
		],
	},
	ember: {
		// The catalogue's sparsest effect: a few dozen embers rising through an
		// otherwise empty frame, measured at 0.0047 of it at defaults, which is
		// below the shared floor and is what the effect is.
		floors: { minLitFraction: 0.0015 },
		extremes: [
			{ name: 'max-density', params: { density: 3 } },
			// Size 5 is the capped-halo path (#473): an ember's glow at the top of
			// the range reaches the edge of the neighbourhood a fragment gathers.
			{ name: 'max-size', params: { size: 5 } },
		],
	},
	fog: {
		extremes: [
			{ name: 'max-softness', params: { blurFactor: 0.95 } },
			{ name: 'max-zoom', params: { zoom: 3 } },
		],
	},
	globe: {
		extremes: [
			{ name: 'max-size', params: { size: 5 } },
			{ name: 'markers-off', params: { showDots: false } },
		],
	},
	halo: {
		// The catalogue's one accumulating effect: the ring is dim on its own and
		// most of what shows on air is its own smear, built up in the feedback
		// buffer over the frames before the one anybody sees. Sampling two frames
		// two seconds apart measures a buffer that has never been filled, so this
		// is the one effect whose clock is stepped frame by frame.
		frameRate: 30,
		extremes: [
			{ name: 'max-size', params: { size: 5 } },
			{ name: 'max-intensity', params: { amplitudeFactor: 4 } },
		],
	},
	inkmap: {
		extremes: [
			{ name: 'low-coverage', params: { coverage: 0.2, contours: 8 } },
			{ name: 'high-coverage', params: { coverage: 0.8, contours: 0 } },
		],
	},
	net: {
		extremes: [
			{
				name: 'max-points',
				params: { points: 30, maxDistance: 80 },
				// Thirty points strung at the top of the connection range is a mesh
				// that covers the frame — measured at 0.79 bright, and correctly so:
				// the operator asked for every point joined to every other. What is
				// left of the ceiling here catches a frame gone entirely white; the
				// ambient-backdrop question is asked of the settings a Screen would
				// actually run, which is what `defaults` above measures.
				floors: { maxBrightFraction: 0.95 },
			},
			{ name: 'markers-off', params: { showDots: false } },
		],
	},
	ridgelines: {
		extremes: [
			{ name: 'min-relief', params: { ridges: 3, relief: 0.2 } },
			{ name: 'max-relief', params: { ridges: 12, relief: 2 } },
		],
	},
	rings: {
		// The catalogue's one effect with no numeric params — its whole
		// configuration is a background colour — so there is no range to take to
		// its extremes and defaults are the entire scenario set.
		extremes: [],
	},
	ripple: {
		extremes: [
			{ name: 'max-rings', params: { ringFactor: 12, amplitudeFactor: 4 } },
			{ name: 'no-rotation', params: { ringFactor: 0, rotationFactor: 0 } },
		],
	},
	shards: {
		extremes: [
			{ name: 'min-size', params: { size: 0.5, intensity: 2 } },
			{ name: 'max-size', params: { size: 3 } },
		],
	},
	waves: {
		extremes: [
			// The water plane leaves the frame's far corners uncovered at low zoom,
			// which is why `backgroundColor` survived the port at all (#473).
			{ name: 'min-zoom', params: { zoom: 0.5, waveHeight: 50 } },
			{ name: 'max-zoom', params: { zoom: 3 } },
		],
	},
	weave: {
		extremes: [
			{ name: 'thin-threads', params: { thickness: 0.2, scale: 3 } },
			{ name: 'thick-threads', params: { thickness: 0.9, scale: 0.5 } },
		],
	},
});

/**
 * The planted failure: a fragment shader that cannot compile, run through the
 * same base, the same mount, and the same measurements as every real effect.
 *
 * It is the control that must fail. A rendering proof whose checks have stopped
 * biting — a pixel count read off the wrong buffer, a compile status never
 * queried — passes everything, and the only way to tell that apart from fifteen
 * healthy shaders is to hand it something that is definitely broken and require
 * it to notice. `undeclaredColor` is not declared anywhere, so the fragment
 * shader fails to compile, the program fails to link, and nothing is drawn.
 */
export const ANIMATION_EFFECT_PROOF_CONTROL = Object.freeze({
	effect: 'planted-broken-shader',
	scenario: 'control',
	fragmentShader: 'void main() { gl_FragColor = undeclaredColor; }',
});

/**
 * The effect every run treats as its known-good control: a shader that has
 * rendered on air since the first slice of #473, so a run where *it* fails is
 * evidence about the run rather than about the catalogue.
 */
export const ANIMATION_EFFECT_PROOF_KNOWN_GOOD = 'fog';

/**
 * Every scenario the run mounts, in catalogue order, defaults first.
 *
 * Both sides derive their work from this one call, so the page cannot mount a
 * scenario the harness is not judging and the harness cannot judge one the page
 * was never asked to mount.
 *
 * `frameRate` is the frames per second of the effect's own clock that the page
 * draws on the way to each sampled time, and `0` — the usual case — means it
 * draws only the sampled times themselves. It exists for effects that accumulate
 * across frames, where the frame anyone sees on air is the sum of the hundred
 * before it; drawing every frame is far slower on a software rasteriser, so it
 * is asked for by name rather than applied to the whole catalogue.
 *
 * @returns {{
 *   effect: string,
 *   scenario: string,
 *   params: Record<string, string | number | boolean>,
 *   frameRate: number,
 *   floors: { minLitFraction: number, maxBrightFraction: number, minChangedFraction: number },
 * }[]} Every mount the run makes, with the floors that mount is judged against.
 */
export function animationEffectProofScenarios() {
	return Object.entries(ANIMATION_EFFECT_PROOF_SCENARIOS).flatMap(([effect, entry]) => {
		const effectFloors = { ...ANIMATION_EFFECT_PROOF_FLOORS, ...entry.floors };
		const frameRate = entry.frameRate ?? 0;
		return [
			{ effect, scenario: 'defaults', params: {}, frameRate, floors: effectFloors },
			...entry.extremes.map(extreme => ({
				effect,
				scenario: extreme.name,
				params: extreme.params,
				frameRate,
				floors: { ...effectFloors, ...extreme.floors },
			})),
		];
	});
}
