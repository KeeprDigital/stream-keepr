/**
 * Every Screen Mode whose definition declares its own Background Layer stack,
 * named by hand so a test does not take the declaration's word for itself: a
 * mode dropping out of the declaration, or joining it, fails the tests that
 * iterate this list rather than passing with one mode fewer.
 */
export const MODES_WITH_A_BACKGROUND_LAYER_STACK = [
	'card',
	'deck',
	'standings',
	'top-cut',
	'metagame',
	'top-cards',
	'player-history',
	'pairings',
	'archetype-spotlight',
	'head-to-head',
] as const;
