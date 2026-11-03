import type { BroadcastGraphicConfig, GraphicAnimationRecipe, GraphicContainerAnimation, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicsPreviewAnimationPlan } from '~/modules/graphics/previewMessages';
import { describe, expect, it } from 'vitest';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { resolveGraphicAnimationPreview } from '~/modules/graphics/animationPreview';

function recipe(duration: number, delay = 0): GraphicAnimationRecipe {
	return {
		duration,
		delay,
		easing: 'linear',
		fade: { opacity: 0 },
	};
}

function shape(id: string, animation?: GraphicItemConfig['animation']): GraphicItemConfig {
	return {
		...getGraphicItemDefinition('shape').createDefault({
			id,
			label: id,
			canvasWidth: 1920,
			canvasHeight: 1080,
		}),
		...(animation
			? { animation }
			: {}),
	} as GraphicItemConfig;
}

function group(id: string, children: GraphicItemConfig[], animation?: GraphicItemConfig['animation']): GraphicItemConfig {
	return {
		...getGraphicItemDefinition('group').createDefault({
			id,
			label: id,
			canvasWidth: 1920,
			canvasHeight: 1080,
		}),
		children,
		...(animation
			? { animation }
			: {}),
	} as GraphicItemConfig;
}

/** Bar enters over 400ms; the badge exits over 300ms after 100ms. */
const composition: BroadcastGraphicConfig = {
	id: 'layout',
	name: 'Layout',
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
	items: [
		shape('bar', {
			enter: recipe(400),
		}),
		shape('badge', {
			exit: recipe(300, 100),
		}),
		group('team', [
			shape('name', {
				enter: recipe(600),
			}),
			shape('flag', {
				enter: recipe(600),
			}),
		], {
			exit: recipe(500),
			stagger: {
				enter: {
					order: 'list',
					step: 100,
					itemIds: ['name', 'flag'],
				},
			},
		}),
	],
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

function owner(graphic: BroadcastGraphicConfig, id: string): GraphicItemConfig | undefined {
	return graphic.items
		.flatMap(item => item.type === 'group'
			? [item, ...item.children]
			: [item])
		.find(item => item.id === id);
}

describe('resolveGraphicAnimationPreview', () => {
	it.each([
		// Whole composition: the latest owner decides each phase, the group's
		// children staggered after the top-level stagger.
		[
			'the whole composition, every phase',
			plan(),
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
			[
				{ phase: 'exit', start: 0, duration: 500 },
			],
		],
		// The badge alone: only its own recipe counts.
		[
			'one item alone',
			plan({ itemId: 'badge' }),
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
			[
				{ phase: 'enter', start: 0, duration: 700 },
			],
		],
		[
			'a group child alone, free of its group',
			plan({ itemId: 'flag', scope: 'phase' }),
			[
				{ phase: 'enter', start: 0, duration: 600 },
			],
		],
		[
			'an item that is not in the composition',
			plan({ itemId: 'gone' }),
			[],
		],
	])('times %s', (_case, run, timeline) => {
		expect(resolveGraphicAnimationPreview(composition, run).timeline).toEqual(timeline);
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
		const { graphic } = resolveGraphicAnimationPreview(composition, plan({ itemId }));

		expect(graphic.animation).toBeUndefined();
		for (const id of ['bar', 'badge', 'team', 'name', 'flag'])
			expect(owner(graphic, id)?.animation !== undefined, id).toBe(moving.includes(id));
		expect((owner(graphic, 'team')?.animation as GraphicContainerAnimation | undefined)?.stagger).toEqual(groupStagger);
		// Geometry and paint are untouched: only motion is isolated.
		expect(owner(graphic, 'badge')?.x).toBe(owner(composition, 'badge')?.x);
	});

	it('keeps a Theme from repainting motion onto an owner held at rest', () => {
		const bound: BroadcastGraphicConfig = {
			...composition,
			themeBindings: { 'animation.enter': 'motion-enter' },
			items: [
				{
					...shape('bar'),
					themeBindings: { 'animation.enter': 'motion-enter', 'surfaceStyle.fill': 'accent' },
				} as GraphicItemConfig,
				{
					...shape('badge'),
					themeBindings: { 'animation.exit': 'motion-exit' },
				} as GraphicItemConfig,
			],
		};

		const { graphic } = resolveGraphicAnimationPreview(bound, plan({ itemId: 'badge' }));

		expect(graphic.themeBindings).toBeUndefined();
		expect(owner(graphic, 'bar')?.themeBindings).toEqual({ 'surfaceStyle.fill': 'accent' });
		expect(owner(graphic, 'badge')?.themeBindings).toEqual({ 'animation.exit': 'motion-exit' });
	});
});
