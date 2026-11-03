import type { BroadcastGraphicConfig, GraphicAnimationRecipe, GraphicContainerAnimation, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicsPreviewAnimationPlan } from '~/modules/graphics/previewMessages';
import { describe, expect, it } from 'vitest';
import { flattenGraphicItems } from '~~/shared/modules/graphics';
import { graphic, group, shape } from '~~/test/helpers/graphicsComposition';
import { resolveGraphicAnimationPreview } from '~/modules/graphics/animationPreview';

function recipe(duration: number, delay = 0): GraphicAnimationRecipe {
	return {
		duration,
		delay,
		easing: 'linear',
		fade: { opacity: 0 },
	};
}

/** Bar enters over 400ms; the badge exits over 300ms after 100ms; the team group staggers its children. */
const composition: BroadcastGraphicConfig = {
	...graphic('layout', [
		shape('bar', {
			animation: {
				enter: recipe(400),
			},
		}),
		shape('badge', {
			animation: {
				exit: recipe(300, 100),
			},
		}),
		group('team', [
			shape('name', {
				animation: {
					enter: recipe(600),
				},
			}),
			shape('flag', {
				animation: {
					enter: recipe(600),
				},
			}),
		], {
			animation: {
				exit: recipe(500),
				stagger: {
					enter: {
						order: 'list',
						step: 100,
						itemIds: ['name', 'flag'],
					},
				},
			},
		}),
	]),
	animation: {
		enter: recipe(200),
		stagger: {
			enter: {
				order: 'list',
				step: 50,
				itemIds: ['bar', 'badge', 'team'],
			},
		},
	},
};

function plan(overrides: Partial<GraphicsPreviewAnimationPlan> = {}): GraphicsPreviewAnimationPlan {
	return {
		graphicId: 'layout',
		scope: 'lifecycle',
		phase: 'enter',
		run: 1,
		speed: 1,
		loop: false,
		...overrides,
	};
}

function owner(previewed: BroadcastGraphicConfig, id: string): GraphicItemConfig | undefined {
	return flattenGraphicItems(previewed).find(item => item.id === id);
}

describe('resolveGraphicAnimationPreview', () => {
	it.each([
		// The latest owner decides each phase; the group's children are staggered after
		// the top-level stagger.
		[
			'the whole composition, every phase',
			plan(),
			undefined,
			[
				{ phase: 'enter', start: 0, duration: 800 },
				{ phase: 'on-screen', start: 800, duration: 0 },
				{ phase: 'update', start: 800, duration: 0 },
				{ phase: 'exit', start: 800, duration: 500 },
			],
		],
		[
			'one phase of the whole composition',
			plan({ scope: 'phase', phase: 'exit' }),
			undefined,
			[
				{ phase: 'exit', start: 0, duration: 500 },
			],
		],
		// A host with no update phase runs straight from on-screen to exit.
		[
			'a lifecycle the host narrows',
			plan(),
			['enter', 'on-screen', 'exit'] as const,
			[
				{ phase: 'enter', start: 0, duration: 800 },
				{ phase: 'on-screen', start: 800, duration: 0 },
				{ phase: 'exit', start: 800, duration: 500 },
			],
		],
		[
			'a phase the host does not have',
			plan({ phase: 'update' }),
			['enter', 'on-screen', 'exit'] as const,
			[],
		],
		[
			'one item alone',
			plan({ itemId: 'badge' }),
			undefined,
			[
				{ phase: 'enter', start: 0, duration: 0 },
				{ phase: 'on-screen', start: 0, duration: 0 },
				{ phase: 'update', start: 0, duration: 0 },
				{ phase: 'exit', start: 0, duration: 400 },
			],
		],
		// A group alone keeps its own stagger over its children, not the composition's.
		[
			'a group alone, with its own stagger',
			plan({ itemId: 'team', scope: 'phase' }),
			undefined,
			[
				{ phase: 'enter', start: 0, duration: 700 },
			],
		],
		[
			'a group child alone, free of its group',
			plan({ itemId: 'flag', scope: 'phase' }),
			undefined,
			[
				{ phase: 'enter', start: 0, duration: 600 },
			],
		],
		[
			'an item that is not in the composition',
			plan({ itemId: 'gone' }),
			undefined,
			[],
		],
	])('times %s', (_case, run, lifecycle, timeline) => {
		expect(resolveGraphicAnimationPreview(composition, run, lifecycle).timeline).toEqual(timeline);
	});

	it('plays the whole composition as authored', () => {
		expect(resolveGraphicAnimationPreview(composition, plan()).graphic).toBe(composition);
	});

	it.each([
		[
			'bar',
			['bar'],
			undefined,
		],
		[
			'team',
			['team', 'name', 'flag'],
			{
				enter: {
					order: 'list',
					step: 100,
					itemIds: ['name', 'flag'],
				},
			},
		],
		[
			'flag',
			['flag'],
			undefined,
		],
	])('moves %s alone, holding every other owner at rest', (itemId, moving, groupStagger) => {
		const previewed = resolveGraphicAnimationPreview(composition, plan({ itemId })).graphic;

		expect(previewed.animation).toBeUndefined();
		for (const id of ['bar', 'badge', 'team', 'name', 'flag'])
			expect(owner(previewed, id)?.animation !== undefined, id).toBe(moving.includes(id));
		expect((owner(previewed, 'team')?.animation as GraphicContainerAnimation | undefined)?.stagger).toEqual(groupStagger);
		// Geometry and paint are untouched: only motion is isolated.
		expect(owner(previewed, 'badge')?.x).toBe(owner(composition, 'badge')?.x);
	});

	it('keeps a Theme from repainting motion onto an owner held at rest', () => {
		const bound: BroadcastGraphicConfig = {
			...graphic('layout', [
				shape('bar', {
					themeBindings: { 'animation.enter': 'motion-enter', 'surfaceStyle.fill': 'accent' },
				}),
				shape('badge', {
					themeBindings: { 'animation.exit': 'motion-exit' },
				}),
			]),
			themeBindings: { 'animation.enter': 'motion-enter' },
		};

		const previewed = resolveGraphicAnimationPreview(bound, plan({ itemId: 'badge' })).graphic;

		expect(previewed.themeBindings).toBeUndefined();
		expect(owner(previewed, 'bar')?.themeBindings).toEqual({ 'surfaceStyle.fill': 'accent' });
		expect(owner(previewed, 'badge')?.themeBindings).toEqual({ 'animation.exit': 'motion-exit' });
	});
});
