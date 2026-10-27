import type { Component } from 'vue';
import type { ThemeTokenType, ThemeTokenValueTypes } from '~~/shared/modules/theme';
import { getGraphicFontDefinition } from '~~/shared/modules/graphics/typography';
import AnimationRecipeTokenInput from '~/components/Theme/AnimationRecipeTokenInput.vue';
import ColorTokenInput from '~/components/Theme/ColorTokenInput.vue';
import DimensionTokenInput from '~/components/Theme/DimensionTokenInput.vue';
import FillTokenInput from '~/components/Theme/FillTokenInput.vue';
import ShapeGeometryTokenInput from '~/components/Theme/ShapeGeometryTokenInput.vue';
import SurfaceStyleTokenInput from '~/components/Theme/SurfaceStyleTokenInput.vue';
import TypographyTokenInput from '~/components/Theme/TypographyTokenInput.vue';
import { themeColorText } from '~/modules/theme-editor/themeColor';

/**
 * How the Theme editor edits each Theme Token type. A new type adds its input
 * and how its value reads as text, or this fails to compile.
 *
 * An input takes `modelValue` (the token's value as it resolves now), `label`,
 * and for a dimension its `bounds`, and emits `commit` with a whole new value
 * once an edit is finished. The editor writes that value as the token.
 */
export const THEME_TOKEN_INPUTS = {
	'color': ColorTokenInput,
	'dimension': DimensionTokenInput,
	'typography': TypographyTokenInput,
	// The composites Graphic Items bind to (#829).
	'fill': FillTokenInput,
	'surface-style': SurfaceStyleTokenInput,
	'shape-geometry': ShapeGeometryTokenInput,
	'animation-recipe': AnimationRecipeTokenInput,
} as const satisfies Record<ThemeTokenType, Component>;

/** A token value as the editor states an inherited default. */
const THEME_TOKEN_VALUE_TEXT: { [T in ThemeTokenType]: (value: ThemeTokenValueTypes[T]) => string } = {
	'color': value => value,
	'dimension': value => `${value}px`,
	'typography': value => [
		getGraphicFontDefinition(value.font.fontId)?.label ?? value.font.fontId,
		String(value.weight),
		`line ${value.lineHeight}`,
		`tracking ${value.tracking}em`,
		value.case === 'none'
			? null
			: value.case,
	].filter(Boolean).join(' · '),
	// The composites Graphic Items bind to (#829).
	'fill': fillText,
	'surface-style': value => [
		fillText(value.fill),
		value.fillOpacity < 1
			? `${Math.round(value.fillOpacity * 100)}%`
			: null,
		value.outline
			? `outline ${themeColorText(value.outline.color)}`
			: null,
		value.glow
			? `glow ${themeColorText(value.glow.color)}`
			: null,
	].filter(Boolean).join(' · '),
	'shape-geometry': value => [
		...new Set([
			value.topLeft,
			value.topRight,
			value.bottomRight,
			value.bottomLeft,
		].map(corner => corner.treatment === 'square'
			? 'square'
			: `${corner.treatment} ${corner.size}px`)),
		value.leftSlant || value.rightSlant
			? 'slanted'
			: null,
	].filter(Boolean).join(' · '),
	'animation-recipe': value => [
		`${value.duration}ms`,
		value.easing,
		...(['fade', 'slide', 'scale', 'reveal'] as const).filter(channel => value[channel]),
	].join(' · '),
};

function fillText(fill: ThemeTokenValueTypes['fill']): string {
	return fill.type === 'solid'
		? themeColorText(fill.color)
		: `gradient · ${fill.stops.map(stop => themeColorText(stop.color)).join(' → ')}`;
}

export function themeTokenValueText<T extends ThemeTokenType>(type: T, value: ThemeTokenValueTypes[T]): string {
	return THEME_TOKEN_VALUE_TEXT[type](value);
}
