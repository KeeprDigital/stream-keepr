import type { GraphicApplicationFontSelection, GraphicTextTransform } from '../../types/graphics';
import { z } from 'zod';
import { clampToShapeBounds } from '../../screenModeConfigs/fields';
import { GRAPHIC_TEXT_TRANSFORM_VALUES } from '../../types/graphics';
import { GRAPHIC_FONT_IDS } from '../graphics/typography';

/**
 * A typography Theme Token: a face and how it is set, never a size. Each
 * consumer owns its size, so one heading style serves large and small text.
 */
export interface ThemeTypography {
	font: GraphicApplicationFontSelection;
	weight: number;
	lineHeight: number;
	/** Letter spacing in em. */
	tracking: number;
	case: GraphicTextTransform;
}

/** What a Theme Token of each type holds. */
export interface ThemeTokenValueTypes {
	/** A CSS colour, which may be translucent. */
	color: string;
	/** Event Canvas pixels. */
	dimension: number;
	typography: ThemeTypography;
}

export type ThemeTokenType = keyof ThemeTokenValueTypes;
export type ThemeTokenValue = ThemeTokenValueTypes[ThemeTokenType];

/** Inclusive bounds of a dimension token, in Event Canvas pixels. */
export interface ThemeDimensionBounds {
	min: number;
	max: number;
}

/** The bounds a dimension token declaring none reads within. */
const DEFAULT_DIMENSION_BOUNDS: ThemeDimensionBounds = { min: 0, max: 4000 };

export type TokenDefinitionOf<T extends ThemeTokenType, Default> = {
	type: T;
	label: string;
	default: Default;
} & (T extends 'dimension' ? { bounds?: ThemeDimensionBounds } : unknown);

/**
 * A Foundation Token: an application-wide role any Screen Mode may consume. It
 * holds a literal only, and ships a default.
 */
export type FoundationTokenDefinition = {
	[T in ThemeTokenType]: TokenDefinitionOf<T, ThemeTokenValueTypes[T]>;
}[ThemeTokenType];

/** The whole Foundation Token vocabulary, by token name. */
export type FoundationTokenVocabulary = Readonly<Record<string, FoundationTokenDefinition>>;

/** A same-type Foundation Token a Mode Token names, as declared or stored. */
export interface ThemeTokenReference<Name extends string = string> {
	token: Name;
}

/** A Mode Token's default, or a stored Mode Token value: a Foundation Token it names, or a literal. */
export type ModeTokenValue<T extends ThemeTokenType = ThemeTokenType, Name extends string = string>
	= | ThemeTokenReference<Name>
		| ThemeTokenValueTypes[T];

/**
 * A Mode Token: a Theme Token a Screen Mode Definition declares for its own
 * rendering. It defaults to a same-type Foundation Token, so a new mode follows
 * every Theme, or to a literal where no Foundation Token fits.
 */
export type ModeTokenDefinition<Name extends string = string> = {
	[T in ThemeTokenType]: TokenDefinitionOf<T, ModeTokenValue<T, Name>>;
}[ThemeTokenType];

/** Mode Tokens by their full name (`<mode>.<token>`). */
export type ModeTokenDeclarations = Readonly<Record<string, ModeTokenDefinition>>;

/**
 * A sparse map of Theme Token values as a Theme or a Screen's overrides store
 * it, keyed by token name. Only what was set is present, and a read trusts
 * nothing in it.
 */
export type StoredThemeTokens = Readonly<Record<string, unknown>>;

const typographySchema = z.object({
	font: z.object({
		kind: z.literal('application'),
		fontId: z.enum(GRAPHIC_FONT_IDS),
	}).strict(),
	weight: z.number().int().min(100).max(900),
	lineHeight: z.number().min(0.5).max(3),
	tracking: z.number().min(-0.5).max(1),
	case: z.enum(GRAPHIC_TEXT_TRANSFORM_VALUES),
}).strict();

function valueSchema(definition: FoundationTokenDefinition | ModeTokenDefinition): z.ZodType {
	switch (definition.type) {
		case 'color':
			return z.string().min(1).max(500);
		case 'dimension': {
			const { min, max } = definition.bounds ?? DEFAULT_DIMENSION_BOUNDS;
			return z.number().min(min).max(max);
		}
		case 'typography':
			return typographySchema;
	}
}

/**
 * A stored literal read as `definition`'s type, or undefined when it is not
 * one. A number outside a bound that has since tightened reads as the nearest
 * bound, as a Screen Mode's stored config does (ADR-0037); anything else that
 * does not fit is ignored, so the read falls through to the next source.
 */
export function readTokenLiteral(definition: FoundationTokenDefinition | ModeTokenDefinition, stored: unknown): ThemeTokenValue | undefined {
	if (stored === undefined)
		return undefined;
	const schema = valueSchema(definition);
	const { value } = clampToShapeBounds({ value: schema }, { value: stored });
	const parsed = schema.safeParse(value);
	return parsed.success
		? parsed.data as ThemeTokenValue
		: undefined;
}
