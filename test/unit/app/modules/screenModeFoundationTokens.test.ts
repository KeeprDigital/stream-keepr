import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import {
	foundationMotionVars,
	foundationTokenVar,
	foundationTypographyStyle,
	screenModeThemeTokenStyle,
} from '~/modules/screen-mode';

// A Screen host sets every Foundation Token a custom property can carry, so a
// display reads the Theme's chrome directly (ADR-0049).

const THEME = {
	'accent': 'rgb(12, 34, 56)',
	'heading': { ...FOUNDATION_TOKENS.heading.default, weight: 900 },
	'motion-enter': { ...FOUNDATION_TOKENS['motion-enter'].default, duration: 1234 },
};

/** The custom property a helper's `var(--…)` read names. */
function propertyOf(read: string) {
	return /^var\((--[\w-]+)\)$/.exec(read)![1]!;
}

/** A plain host and an edge-to-edge one, each with a mode declaring Mode Tokens and one declaring none. */
const HOSTED_MODES = [
	'standings',
	'talent',
	'feature-match-overlay',
	'background',
] as const satisfies readonly ScreenMode[];

describe('the custom properties a Screen host sets', () => {
	it.each(HOSTED_MODES)('carry the Theme\'s Foundation Tokens to the %s display, whatever Mode Tokens it declares', (mode) => {
		const style = screenModeThemeTokenStyle(mode, THEME, {});

		expect({
			accent: style[propertyOf(foundationTokenVar('accent'))],
			headingWeight: style[propertyOf(foundationTypographyStyle('heading').fontWeight)],
			bodyWeight: style[propertyOf(foundationTypographyStyle('body').fontWeight)],
			enterDuration: style[propertyOf(foundationMotionVars('motion-enter').duration)],
		}).toEqual({
			accent: 'rgb(12, 34, 56)',
			headingWeight: '900',
			bodyWeight: String(FOUNDATION_TOKENS.body.default.weight),
			enterDuration: '1234ms',
		});
	});
});
