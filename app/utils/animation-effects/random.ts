/**
 * The retired fork's random helpers (`rn`/`ri`), shared by the ports that kept
 * its random construction: `randomInt`'s off-by-design inclusive end — and its
 * tolerance of a non-integer end — are load-bearing for port fidelity, so the
 * ports share one definition rather than three drifting copies.
 */

export function randomBetween(start: number, end: number): number {
	return start + Math.random() * (end - start);
}

export function randomInt(start: number, end: number): number {
	return Math.floor(start + Math.random() * (end - start + 1));
}
