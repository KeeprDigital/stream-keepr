import type {
	BroadcastGraphicConfig,
	GraphicAnimationPhase,
	GraphicFill,
	GraphicGroupChildConfig,
	GraphicItemConfig,
	GraphicSurfaceStyle,
} from '../../types/graphics';
import type { GraphicThemeBindings, GraphicThemeSlot } from '../../types/graphicThemeBindings';
import type { FoundationTokenName, StoredThemeTokens, ThemeSurfaceStyle, ThemeTokenType, ThemeTokenValue, ThemeTypography } from '../theme';
import { GRAPHIC_THEME_SLOT_VALUES } from '../../types/graphicThemeBindings';
import { DEFAULT_THEME_TOKENS, FOUNDATION_TOKENS, resolveFoundationTokens } from '../theme';
import {
	createDefaultGraphicSurfaceStyle,
	getGraphicItemDefinition,
	ownsGraphicSurfaceStyle,
	ownsGraphicTypography,
} from './itemDefinitions';

/**
 * Graphic Item Theme bindings: the one home of how a bound property follows a
 * Foundation Token (ADR-0049, #829).
 *
 * - **Paint** (`paintBroadcastGraphicThemeBindings`): the compositor paints
 *   every bound property group from the Screen's resolved Foundation Tokens,
 *   so a Screen Theme Override or a Theme edit restyles it while on air.
 * - **Bind** replaces the literal with the token's value; **detach** copies
 *   the token's resolved value in as the literal. There is no partial binding
 *   and no override record.
 * - **Release**: an author's edit to a bound property group detaches it,
 *   keeping what the author made of the resolved value.
 *
 * A binding naming no Foundation Token of its slot's type, or a slot its owner
 * does not have, is inert: the owner keeps its literal.
 */

/** Resolved Foundation Tokens by name, as one Screen or editor preview resolves them. */
export type GraphicThemeTokens = Readonly<Record<string, ThemeTokenValue>>;

/** Something that binds: one Graphic Item, or a Broadcast Graphic for its own motion. */
export type GraphicThemeOwner = GraphicItemConfig | BroadcastGraphicConfig;

/** The Foundation Token type each slot binds to. */
export const GRAPHIC_THEME_SLOT_TOKEN_TYPES = {
	'typography': 'typography',
	'typography.color': 'color',
	'surfaceStyle': 'surface-style',
	'surfaceStyle.fill': 'fill',
	'defaultChildSurfaceStyle': 'surface-style',
	'boxSurfaceStyle': 'surface-style',
	'wonBoxSurfaceStyle': 'surface-style',
	'geometry': 'shape-geometry',
	'clipGeometry': 'shape-geometry',
	'boxGeometry': 'shape-geometry',
	'color': 'color',
	'animation.enter': 'animation-recipe',
	'animation.update': 'animation-recipe',
	'animation.exit': 'animation-recipe',
} as const satisfies Record<GraphicThemeSlot, ThemeTokenType>;

const ANIMATION_SLOT_PHASES: Partial<Record<GraphicThemeSlot, GraphicAnimationPhase>> = {
	'animation.enter': 'enter',
	'animation.update': 'update',
	'animation.exit': 'exit',
};

/** A Screen's resolved Foundation Tokens, from its Theme's stored values and its overrides. */
export function resolveGraphicThemeTokens(theme?: StoredThemeTokens, overrides?: StoredThemeTokens): GraphicThemeTokens {
	return resolveFoundationTokens({
		vocabulary: FOUNDATION_TOKENS,
		theme: theme ?? DEFAULT_THEME_TOKENS,
		overrides: overrides ?? {},
	});
}

/** The Default Theme's Foundation Tokens: what paints where no Theme is in reach. */
export const DEFAULT_GRAPHIC_THEME_TOKENS: GraphicThemeTokens = resolveGraphicThemeTokens();

/** The Foundation Tokens a slot may name, in vocabulary order. */
export function graphicThemeSlotTokens(slot: GraphicThemeSlot): FoundationTokenName[] {
	const type = GRAPHIC_THEME_SLOT_TOKEN_TYPES[slot];
	return (Object.keys(FOUNDATION_TOKENS) as FoundationTokenName[])
		.filter(name => FOUNDATION_TOKENS[name].type === type);
}

function isItem(owner: GraphicThemeOwner): owner is GraphicItemConfig {
	return 'type' in owner;
}

/** Whether `owner` has the property group `slot` names, read from its kind. */
export function graphicThemeOwnerSupportsSlot(owner: GraphicThemeOwner, slot: GraphicThemeSlot): boolean {
	if (ANIMATION_SLOT_PHASES[slot])
		return true;
	if (!isItem(owner))
		return false;
	switch (slot) {
		case 'typography':
		case 'typography.color':
			return ownsGraphicTypography(owner);
		case 'surfaceStyle':
		case 'surfaceStyle.fill':
			return ownsGraphicSurfaceStyle(owner, 'surfaceStyle');
		case 'defaultChildSurfaceStyle':
		case 'boxSurfaceStyle':
		case 'wonBoxSurfaceStyle':
			return ownsGraphicSurfaceStyle(owner, slot);
		case 'geometry':
		case 'clipGeometry':
		case 'boxGeometry':
			return getGraphicItemDefinition(owner.type).shapeGeometry?.slot === slot;
		case 'color':
			return owner.type === 'social-network-icon';
		default:
			return false;
	}
}

/** The token a binding names, when it names a Foundation Token of its slot's type. */
function boundValue(slot: GraphicThemeSlot, name: string | undefined, tokens: GraphicThemeTokens): ThemeTokenValue | undefined {
	if (name === undefined || !Object.hasOwn(FOUNDATION_TOKENS, name))
		return undefined;
	return FOUNDATION_TOKENS[name as FoundationTokenName].type === GRAPHIC_THEME_SLOT_TOKEN_TYPES[slot]
		? tokens[name]
		: undefined;
}

/**
 * What a binding owns of a slot's property group: compared to tell whether an
 * edit touched it. A typography token owns face and setting but never size,
 * alignment, style or colour.
 */
function ownedSlotValue(owner: GraphicThemeOwner, slot: GraphicThemeSlot): unknown {
	const phase = ANIMATION_SLOT_PHASES[slot];
	if (phase)
		return owner.animation?.[phase];
	const fields = owner as unknown as Record<string, unknown>;
	switch (slot) {
		case 'typography': {
			const typography = fields.typography as Record<string, unknown> | undefined;
			return typography && {
				font: typography.font,
				fontWeight: typography.fontWeight,
				lineHeight: typography.lineHeight,
				letterSpacing: typography.letterSpacing,
				textTransform: typography.textTransform,
			};
		}
		case 'typography.color':
			return (fields.typography as { color?: string } | undefined)?.color;
		case 'surfaceStyle.fill':
			return (fields.surfaceStyle as GraphicSurfaceStyle | undefined)?.fill;
		default:
			return fields[slot];
	}
}

/** `owner` with one slot painted from a token value of the slot's type. */
function paintSlot<T extends GraphicThemeOwner>(owner: T, slot: GraphicThemeSlot, value: ThemeTokenValue): T {
	const phase = ANIMATION_SLOT_PHASES[slot];
	if (phase) {
		return {
			...owner,
			animation: { ...owner.animation, [phase]: value },
		};
	}
	const item = owner as unknown as Record<string, unknown>;
	switch (slot) {
		case 'typography': {
			const typography = item.typography as Record<string, unknown> & { fontSize: number };
			const token = value as ThemeTypography;
			return {
				...owner,
				typography: {
					...typography,
					font: token.font,
					fontWeight: token.weight,
					lineHeight: token.lineHeight,
					// Tracking is in em; an item's letter spacing is in pixels at its own size.
					letterSpacing: Math.round(token.tracking * typography.fontSize * 100) / 100,
					textTransform: token.case,
				},
			};
		}
		case 'typography.color':
			return {
				...owner,
				typography: { ...(item.typography as object), color: value },
			};
		case 'surfaceStyle.fill':
			return {
				...owner,
				surfaceStyle: {
					...((item.surfaceStyle as GraphicSurfaceStyle | undefined) ?? createDefaultGraphicSurfaceStyle()),
					fill: value as GraphicFill,
				},
			};
		case 'surfaceStyle':
		case 'defaultChildSurfaceStyle':
		case 'boxSurfaceStyle':
		case 'wonBoxSurfaceStyle':
			// Resolved, so every colour is a literal: a Graphic Surface Style.
			return { ...owner, [slot]: value as ThemeSurfaceStyle<string> };
		default:
			return { ...owner, [slot]: value };
	}
}

/** `owner` with each of its own bound slots painted; the same object when none paints. */
export function paintGraphicThemeOwner<T extends GraphicThemeOwner>(owner: T, tokens: GraphicThemeTokens): T {
	const bindings = owner.themeBindings as GraphicThemeBindings | undefined;
	if (!bindings)
		return owner;
	let painted = owner;
	// Coarse before fine, so a bound fill paints over a bound surface's own fill.
	for (const slot of GRAPHIC_THEME_SLOT_VALUES) {
		const value = boundValue(slot, bindings[slot], tokens);
		if (value !== undefined && graphicThemeOwnerSupportsSlot(owner, slot))
			painted = paintSlot(painted, slot, value);
	}
	return painted;
}

/** Every Graphic Item of `graphic`, and its own motion, painted from `tokens`. */
export function paintBroadcastGraphicThemeBindings(graphic: BroadcastGraphicConfig, tokens: GraphicThemeTokens): BroadcastGraphicConfig {
	let changed = false;
	const items = graphic.items.map((item) => {
		let next = paintGraphicThemeOwner(item, tokens);
		if (next.type === 'group') {
			const group = next;
			const children = group.children.map(child => paintGraphicThemeOwner(child, tokens) as GraphicGroupChildConfig);
			if (children.some((child, index) => child !== group.children[index]!))
				next = { ...group, children };
		}
		changed ||= next !== item;
		return next;
	});
	const painted = paintGraphicThemeOwner(graphic, tokens);
	return changed
		? { ...painted, items }
		: painted;
}

function withBindings<T extends GraphicThemeOwner>(owner: T, bindings: GraphicThemeBindings): T {
	const next = { ...owner };
	if (Object.keys(bindings).length === 0)
		delete next.themeBindings;
	else
		next.themeBindings = bindings;
	return next;
}

/**
 * `owner` with `slot` bound to the Foundation Token `token`, its literal
 * replaced by the token's value. A token of another type, or a slot the owner
 * does not have, binds nothing.
 */
export function bindGraphicThemeOwner<T extends GraphicThemeOwner>(owner: T, slot: GraphicThemeSlot, token: string, tokens: GraphicThemeTokens): T {
	const value = boundValue(slot, token, tokens);
	if (value === undefined || !graphicThemeOwnerSupportsSlot(owner, slot))
		return owner;
	return withBindings(paintSlot(owner, slot, structuredClone(value)), { ...owner.themeBindings, [slot]: token });
}

/** `owner` with `slot` detached: the token's resolved value copied in as its literal. */
export function detachGraphicThemeOwner<T extends GraphicThemeOwner>(owner: T, slot: GraphicThemeSlot, tokens: GraphicThemeTokens): T {
	const bindings = owner.themeBindings as GraphicThemeBindings | undefined;
	if (bindings?.[slot] === undefined)
		return owner;
	const value = boundValue(slot, bindings[slot], tokens);
	const painted = value !== undefined && graphicThemeOwnerSupportsSlot(owner, slot)
		? paintSlot(owner, slot, structuredClone(value))
		: owner;
	const next = { ...bindings };
	delete next[slot];
	return withBindings(painted, next);
}

/** Applies `update` to the owner `ownerId` names in `graphic`: the graphic itself for null. */
function updateOwner(
	graphic: BroadcastGraphicConfig,
	ownerId: string | null,
	update: <T extends GraphicThemeOwner>(owner: T) => T,
): BroadcastGraphicConfig {
	if (ownerId === null)
		return update(graphic);
	return {
		...graphic,
		items: graphic.items.map((item) => {
			if (item.id === ownerId)
				return update(item);
			if (item.type !== 'group' || !item.children.some(child => child.id === ownerId))
				return item;
			return {
				...item,
				children: item.children.map(child => child.id === ownerId
					? update(child)
					: child),
			};
		}),
	};
}

/** Binds one slot of the owner `ownerId` names (the graphic itself for null). */
export function bindGraphicThemeToken(
	graphic: BroadcastGraphicConfig,
	ownerId: string | null,
	slot: GraphicThemeSlot,
	token: string,
	tokens: GraphicThemeTokens,
): BroadcastGraphicConfig {
	return updateOwner(graphic, ownerId, owner => bindGraphicThemeOwner(owner, slot, token, tokens));
}

/** Detaches one slot of the owner `ownerId` names (the graphic itself for null). */
export function detachGraphicThemeToken(
	graphic: BroadcastGraphicConfig,
	ownerId: string | null,
	slot: GraphicThemeSlot,
	tokens: GraphicThemeTokens,
): BroadcastGraphicConfig {
	return updateOwner(graphic, ownerId, owner => detachGraphicThemeOwner(owner, slot, tokens));
}

function ownersById(graphic: BroadcastGraphicConfig): Map<string, GraphicItemConfig> {
	const owners = new Map<string, GraphicItemConfig>();
	for (const item of graphic.items) {
		owners.set(item.id, item);
		if (item.type === 'group') {
			for (const child of item.children)
				owners.set(child.id, child);
		}
	}
	return owners;
}

function releaseOwner<T extends GraphicThemeOwner>(painted: GraphicThemeOwner | undefined, edited: T): T {
	const bindings = edited.themeBindings as GraphicThemeBindings | undefined;
	if (!painted || !bindings)
		return edited;
	const before = painted.themeBindings as GraphicThemeBindings | undefined;
	// A binding the edit itself made is the edit; only one it found can be released.
	const kept = Object.fromEntries(Object.entries(bindings).filter(([slot, token]) =>
		before?.[slot as GraphicThemeSlot] !== token
		|| JSON.stringify(ownedSlotValue(painted, slot as GraphicThemeSlot)) === JSON.stringify(ownedSlotValue(edited, slot as GraphicThemeSlot))));
	return Object.keys(kept).length === Object.keys(bindings).length
		? edited
		: withBindings(edited, kept);
}

/**
 * `edited` with every binding whose property group the edit changed released,
 * so the author's value is kept as a literal. `painted` is the graphic as the
 * edit started from it, with its bindings painted: an edit to a bound group
 * starts from the token's resolved value, so what the author made of it is
 * exactly what detaching would have kept, edited.
 */
export function releaseEditedGraphicThemeBindings(painted: BroadcastGraphicConfig, edited: BroadcastGraphicConfig): BroadcastGraphicConfig {
	const before = ownersById(painted);
	let changed = false;
	const items = edited.items.map((item) => {
		let next = releaseOwner(before.get(item.id), item);
		if (next.type === 'group') {
			const group = next;
			const children = group.children.map(child => releaseOwner(before.get(child.id), child));
			if (children.some((child, index) => child !== group.children[index]!))
				next = { ...group, children };
		}
		changed ||= next !== item;
		return next;
	});
	const released = releaseOwner(painted, edited);
	return changed
		? { ...released, items }
		: released;
}

/**
 * What a newly authored Graphic Item of each kind binds, so a fresh graphic
 * already matches the Theme. A surface the kind leaves absent until authored,
 * and motion, which a new item has none of, stay unbound.
 */
const NEW_GRAPHIC_ITEM_THEME_BINDINGS: Partial<Record<GraphicItemConfig['type'], GraphicThemeBindings>> = {
	'text': { 'typography': 'body', 'typography.color': 'text-primary' },
	'shape': { surfaceStyle: 'panel', geometry: 'panel-shape' },
	'social-network-icon': { color: 'text-primary' },
	'group': { geometry: 'panel-shape' },
	'clock': { 'typography': 'body', 'typography.color': 'text-primary' },
	'player-life': { 'typography': 'body', 'typography.color': 'text-primary' },
	'game-wins': { 'typography': 'body', 'typography.color': 'text-primary' },
	'deck-list': { 'typography': 'body', 'typography.color': 'text-primary' },
};

/** A newly authored item, bound to its kind's Foundation Tokens and painted from the Default Theme. */
export function bindNewGraphicItem<T extends GraphicItemConfig>(item: T): T {
	const bindings = NEW_GRAPHIC_ITEM_THEME_BINDINGS[item.type] ?? {};
	return (Object.entries(bindings) as [GraphicThemeSlot, string][]).reduce(
		(bound, [slot, token]) => bindGraphicThemeOwner(bound, slot, token, DEFAULT_GRAPHIC_THEME_TOKENS),
		item,
	);
}
