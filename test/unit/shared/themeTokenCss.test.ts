import type { GraphicAnimationRecipe } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { themeTokenCssProperties } from '~~/shared/modules/theme';

// A motion token reaches a display's CSS transition as its timing and the
// excursion state the element enters from and leaves to; its rest is opacity 1,
// no transform and no clip.

const timing = { duration: 300, easing: 'ease-out', delay: 50 } as const;

describe('a motion token as custom properties', () => {
	it.each<[string, GraphicAnimationRecipe, Record<string, string>]>([
		[
			'a fade and a scale about a corner',
			{
				...timing,
				fade: { opacity: 0.25 },
				scale: { factor: 0.5, origin: 'top-left' },
			},
			{
				opacity: '0.25',
				transform: 'translate(0px, 0px) scale(0.5)',
				origin: '0% 0%',
				clip: 'inset(0 0 0 0)',
			},
		],
		[
			'a fixed slide, a full unit on each axis of a diagonal',
			{
				...timing,
				slide: { direction: 'north-east', distanceMode: 'fixed', distance: 40 },
			},
			{
				opacity: '1',
				transform: 'translate(40px, -40px) scale(1)',
				origin: '50% 50%',
				clip: 'inset(0 0 0 0)',
			},
		],
		[
			'a slide clearing its parent, which travels the whole Screen',
			{
				...timing,
				slide: { direction: 'west', distanceMode: 'clear-parent', distance: 0 },
			},
			{
				opacity: '1',
				transform: 'translate(calc(-1 * 100cqw), calc(0 * 100cqh)) scale(1)',
				origin: '50% 50%',
				clip: 'inset(0 0 0 0)',
			},
		],
		[
			'a reveal, fully clipped from the edge opposite the one it wipes from',
			{
				...timing,
				reveal: { edge: 'left' },
			},
			{
				opacity: '1',
				transform: 'translate(0px, 0px) scale(1)',
				origin: '50% 50%',
				clip: 'inset(0 100% 0 0)',
			},
		],
		[
			'no channel, which cuts, taking no time',
			{ ...timing },
			{
				duration: '0ms',
				delay: '0ms',
				opacity: '1',
				transform: 'translate(0px, 0px) scale(1)',
				origin: '50% 50%',
				clip: 'inset(0 0 0 0)',
			},
		],
	])('sets %s', (_case, recipe, excursion) => {
		expect(themeTokenCssProperties({ 'card.motion': recipe })).toEqual({
			'--theme-card-motion-duration': '300ms',
			'--theme-card-motion-easing': 'cubic-bezier(0.5, 1, 0.89, 1)',
			'--theme-card-motion-delay': '50ms',
			...Object.fromEntries(Object.entries(excursion).map(([part, css]) => [`--theme-card-motion-${part}`, css])),
		});
	});
});
