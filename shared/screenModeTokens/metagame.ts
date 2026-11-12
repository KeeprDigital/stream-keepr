import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import type { ScreenSettingsGroupOf } from '../screenModeConfigs/contract';
import type { metagameModeConfigContract } from '../screenModeConfigs/metagame';
import { rowMotionModeToken } from './rowMotion';

/** The groups its Mode Tokens may name: the Screen Settings Groups its config contract declares (ADR-0072). */
export type MetagameSettingsGroup = ScreenSettingsGroupOf<typeof metagameModeConfigContract>;

/**
 * How the Metagame Screen Mode looks: its Mode Tokens, by name within the mode.
 * Every bar is named, so identity never rests on its colour alone.
 */
export const metagameModeTokens = {
	// The row motion Standings shares; a chart bar also grows on its timing.
	'row-motion': rowMotionModeToken,
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<MetagameSettingsGroup>>>;

/**
 * The Mode Tokens Metagame once declared: its chart slots, which only repeated
 * the `series-1` … `series-8` and `series-other` Foundation Tokens its chart now
 * reads directly, then its type and shared chrome, which did the same, and the
 * table and chart's max width, now its config's `maxWidth` (#1081).
 */
export const metagameFormerModeTokens = [
	'chart-series-1',
	'chart-series-2',
	'chart-series-3',
	'chart-series-4',
	'chart-series-5',
	'chart-series-6',
	'chart-series-7',
	'chart-series-8',
	'chart-other',
	'surface',
	'title-typography',
	'title-text',
	'title-divider',
	'row-typography',
	'row-divider',
	'primary-text',
	'secondary-text',
	'header-typography',
	'header-text',
	'header-divider',
	'chart-baseline',
	'max-width',
] as const;
