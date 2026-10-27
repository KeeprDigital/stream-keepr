import type { Component } from 'vue';
import type { ThemeTokenType, ThemeTokenValueTypes } from '~~/shared/modules/theme';
import { ANIMATION_EFFECT_CATALOGUE } from '~~/shared/animationEffects';
import { getGraphicFontDefinition } from '~~/shared/modules/graphics/typography';
import AnimationEffectTokenInput from '~/components/Theme/AnimationEffectTokenInput.vue';
import BackgroundLayersTokenInput from '~/components/Theme/BackgroundLayersTokenInput.vue';
import ColorTokenInput from '~/components/Theme/ColorTokenInput.vue';
import DimensionTokenInput from '~/components/Theme/DimensionTokenInput.vue';
import TypographyTokenInput from '~/components/Theme/TypographyTokenInput.vue';

/**
 * How the Theme editor edits each Theme Token type. A new type adds its input
 * and how its value reads as text, or this fails to compile.
 *
 * An input takes `modelValue` (the token's value as it resolves now), `label`,
 * and for a dimension its `bounds`, and emits `commit` with a whole new value
 * once an edit is finished. The editor writes that value as the token.
 */
export const THEME_TOKEN_INPUTS = {
	color: ColorTokenInput,
	dimension: DimensionTokenInput,
	typography: TypographyTokenInput,
	backgroundLayers: BackgroundLayersTokenInput,
	animationEffect: AnimationEffectTokenInput,
} as const satisfies Record<ThemeTokenType, Component>;

/** A token value as the editor states an inherited default. */
const THEME_TOKEN_VALUE_TEXT: { [T in ThemeTokenType]: (value: ThemeTokenValueTypes[T]) => string } = {
	color: value => value,
	dimension: value => `${value}px`,
	typography: value => [
		getGraphicFontDefinition(value.font.fontId)?.label ?? value.font.fontId,
		String(value.weight),
		`line ${value.lineHeight}`,
		`tracking ${value.tracking}em`,
		value.case === 'none'
			? null
			: value.case,
	].filter(Boolean).join(' · '),
	backgroundLayers: value => value.length === 0
		? 'no layers'
		: `${value.length} ${value.length === 1
			? 'layer'
			: 'layers'}`,
	animationEffect: value => ANIMATION_EFFECT_CATALOGUE[value.effect].label,
};

export function themeTokenValueText<T extends ThemeTokenType>(type: T, value: ThemeTokenValueTypes[T]): string {
	return THEME_TOKEN_VALUE_TEXT[type](value);
}
