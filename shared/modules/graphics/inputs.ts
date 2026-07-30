import type {
	GraphicInputDeclaration,
	GraphicInputValue,
	GraphicPlaceholderStyle,
	GraphicTypography,
} from '../../types/graphics';
import {
	DEFAULT_ON_AIR_UPDATE_POLICY,
	MAX_GRAPHIC_TEXT_LENGTH,
} from '../../types/graphics';

/**
 * Typed Graphic Inputs: what a declared value means, and when it is available.
 *
 * ## Unavailable, never coerced
 *
 * Nothing here changes a value. A value that violates its declared type or
 * constraints is reported unavailable together with the reason, and every caller
 * — the compositor, the acceptance reducer, Live Control — treats an unavailable
 * value as one that cannot go on air rather than as one to clamp, truncate, or
 * substitute. That is why availability is a judgement returned about a value and
 * never a transformation of it.
 *
 * An absent value is unavailable for the same reason: there is nothing to show.
 * Whether that blocks anything is the declaration's `required` flag, not this
 * module's business.
 */

/** Whether one value may be shown for its Graphic Input, and why not when it may not. */
export type GraphicInputAvailability
	= | { available: true }
		| { available: false; reason: string };

const AVAILABLE: GraphicInputAvailability = { available: true };

function unavailable(reason: string): GraphicInputAvailability {
	return { available: false, reason };
}

/** Hex colour, in the three lengths a colour control produces. */
const HEX_COLOUR_VALUE = /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;

/**
 * A pinned Graphic Asset Reference, structurally. Whether the revision resolves
 * is a Missing or Unavailable Graphic Asset Content question the library answers,
 * not a constraint on the value.
 */
function isGraphicAssetReferenceShape(value: unknown): boolean {
	if (typeof value !== 'object' || value === null)
		return false;
	const candidate = value as { assetId?: unknown; revisionId?: unknown };
	return typeof candidate.assetId === 'string' && candidate.assetId.length > 0
		&& typeof candidate.revisionId === 'string' && candidate.revisionId.length > 0;
}

/** The value a placed Broadcast Graphic starts from: its declared default. */
export function defaultGraphicInputValue(declaration: GraphicInputDeclaration): GraphicInputValue {
	return declaration.default;
}

export function graphicInputAvailability(
	declaration: GraphicInputDeclaration,
	value: GraphicInputValue | undefined,
): GraphicInputAvailability {
	if (value === null || value === undefined)
		return unavailable('No value');

	switch (declaration.type) {
		case 'text': {
			if (typeof value !== 'string')
				return unavailable('Expected text');
			if (value.length > declaration.maxLength)
				return unavailable(`Longer than ${declaration.maxLength} characters`);
			// Blank text is a value an optional input may legitimately hold, and is
			// absence for a required one: the whole point of requiring a Graphic Input
			// is that program never shows the empty space where it should have been.
			if (declaration.required && value.trim() === '')
				return unavailable('No value');
			return AVAILABLE;
		}
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value))
				return unavailable('Expected a number');
			if (declaration.integer && !Number.isInteger(value))
				return unavailable('Expected a whole number');
			if (declaration.min !== undefined && value < declaration.min)
				return unavailable(`Below the minimum of ${declaration.min}`);
			if (declaration.max !== undefined && value > declaration.max)
				return unavailable(`Above the maximum of ${declaration.max}`);
			return AVAILABLE;
		}
		case 'toggle':
			return typeof value === 'boolean' ? AVAILABLE : unavailable('Expected on or off');
		case 'choice': {
			if (typeof value !== 'string')
				return unavailable('Expected one of the declared choices');
			return declaration.options.some(option => option.value === value)
				? AVAILABLE
				: unavailable('Not one of the declared choices');
		}
		case 'color': {
			if (typeof value !== 'string')
				return unavailable('Expected a colour');
			return HEX_COLOUR_VALUE.test(value) ? AVAILABLE : unavailable('Not a hex colour');
		}
		case 'media':
			return isGraphicAssetReferenceShape(value)
				? AVAILABLE
				: unavailable('Expected a Graphics Asset Library revision');
	}
}

export function isGraphicInputAvailable(
	declaration: GraphicInputDeclaration,
	value: GraphicInputValue | undefined,
): boolean {
	return graphicInputAvailability(declaration, value).available;
}

/**
 * What one Graphic Input contributes to a Graphic Text Template.
 *
 * A text, number, choice, or colour input substitutes its value; a choice
 * substitutes the label the operator picked, because that is the broadcast-facing
 * side of a stable option value. A toggle and a media reference are not
 * text-shaped and contribute nothing — a toggle gates content and a media
 * reference is rendered by a Media Graphic Item, so substituting either into a
 * sentence would only produce something an operator did not ask for.
 *
 * An unavailable value contributes nothing either: substitution renders a value
 * or renders none, and never falls back to the template default.
 */
export function graphicInputTextValue(
	declaration: GraphicInputDeclaration,
	value: GraphicInputValue | undefined,
): string {
	if (!isGraphicInputAvailable(declaration, value))
		return '';

	switch (declaration.type) {
		case 'text':
			return value as string;
		case 'number':
			return String(value as number);
		case 'choice': {
			const option = declaration.options.find(entry => entry.value === value);
			return option?.label ?? (value as string);
		}
		case 'color':
			return value as string;
		case 'toggle':
		case 'media':
			return '';
	}
}

/** The declared Graphic Input with this key, if this Broadcast Graphic declares one. */
export function findGraphicInputDeclaration(
	declarations: readonly GraphicInputDeclaration[] | undefined,
	key: string,
): GraphicInputDeclaration | undefined {
	return declarations?.find(declaration => declaration.key === key);
}

/**
 * A newly declared Graphic Input of one type.
 *
 * A new declaration is optional and staged: an author opts into blocking Take and
 * into immediate on-air application, rather than discovering either.
 */
export function createDefaultGraphicInputDeclaration(
	type: GraphicInputDeclaration['type'],
	options: { key: string; label: string },
): GraphicInputDeclaration {
	const base = {
		key: options.key,
		label: options.label,
		required: false,
		updatePolicy: DEFAULT_ON_AIR_UPDATE_POLICY,
	} as const;

	switch (type) {
		case 'text':
			return { ...base, type: 'text', default: '', maxLength: MAX_GRAPHIC_TEXT_LENGTH };
		case 'number':
			return { ...base, type: 'number', default: null, integer: false };
		case 'toggle':
			return { ...base, type: 'toggle', default: false };
		case 'choice':
			return { ...base, type: 'choice', default: null, options: [] };
		case 'color':
			return { ...base, type: 'color', default: null };
		case 'media':
			return { ...base, type: 'media', default: null, mediaKind: 'image' };
	}
}

/** The typography properties a Graphic Placeholder Style may override. */
export const GRAPHIC_PLACEHOLDER_STYLE_KEYS = [
	'fontId',
	'fontSize',
	'fontWeight',
	'fontStyle',
	'textTransform',
	'letterSpacing',
	'color',
] as const satisfies readonly (keyof GraphicTypography)[];

/** One placeholder's typography: the item's base, with its own overrides applied. */
export function resolveGraphicPlaceholderTypography(
	base: GraphicTypography,
	style: GraphicPlaceholderStyle | undefined,
): GraphicTypography {
	if (!style)
		return base;

	const resolved = { ...base };
	for (const key of GRAPHIC_PLACEHOLDER_STYLE_KEYS) {
		const override = style[key];
		if (override !== undefined)
			(resolved as Record<string, unknown>)[key] = override;
	}
	return resolved;
}
