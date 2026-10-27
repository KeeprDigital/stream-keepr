/**
 * Graphic Item Theme bindings (ADR-0049, #829): which of an owner's property
 * groups follow a Foundation Token.
 *
 * A bound property names a whole Foundation Token of its slot's type, and the
 * compositor paints the token's resolved value over it; an unbound one holds
 * its own literal. There is no partial binding and no override record: detach
 * copies the resolved value in as a literal, bind replaces the literal.
 *
 * The property itself stays stored beside the binding, holding the value it
 * last resolved to, so the document is complete without a Theme in reach.
 */

/**
 * The property groups a Graphic Item or Broadcast Graphic may bind.
 *
 * Media treatment and `animation.on-screen` have no slot, because no token
 * type fills either. Text colour is its own slot, because a typography token
 * carries no colour; `color` is a Social Network Icon's, and `media` a Media
 * Graphic Item's picture, which an asset token such as `logo` fills (#831).
 */
export const GRAPHIC_THEME_SLOT_VALUES = [
	'typography',
	'typography.color',
	'surfaceStyle',
	'surfaceStyle.fill',
	'defaultChildSurfaceStyle',
	'boxSurfaceStyle',
	'wonBoxSurfaceStyle',
	'geometry',
	'clipGeometry',
	'boxGeometry',
	'color',
	'media',
	'animation.enter',
	'animation.update',
	'animation.exit',
] as const;

export type GraphicThemeSlot = typeof GRAPHIC_THEME_SLOT_VALUES[number];

/** The slots naming a lifecycle phase's Graphic Animation Recipe. */
export type GraphicThemeAnimationSlot = Extract<GraphicThemeSlot, `animation.${string}`>;

/** An owner's bindings: each bound slot's Foundation Token name. */
export type GraphicThemeBindings = {
	[S in GraphicThemeSlot]?: string;
};

/** A Broadcast Graphic's own bindings: whole-graphic motion and nothing else. */
export type GraphicContainerThemeBindings = Pick<GraphicThemeBindings, GraphicThemeAnimationSlot>;
