import type { BroadcastGraphicConfig, GraphicGroupItemConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicAnimationPreset,
	applyGraphicItemAnimationPreset,
	createDefaultGraphicAnimationRecipe,
	deleteGraphicItem,
	enableBroadcastGraphicAnimationPhase,
	enableGraphicItemAnimationPhase,
	findGraphicItem,
	patchBroadcastGraphicAnimationChannel,
	patchBroadcastGraphicAnimationRecipe,
	patchBroadcastGraphicAnimationStagger,
	patchGraphicItemAnimationChannel,
	patchGraphicItemAnimationRecipe,
	patchGraphicItemAnimationStagger,
	setBroadcastGraphicAnimationRecipe,
	setGraphicItemAnimationRecipe,
	toggleBroadcastGraphicStaggerMember,
	toggleGraphicItemStaggerMember,
} from '~~/shared/modules/graphics';

const SQUARE = { treatment: 'square' as const, size: 0 };
const GEOMETRY = {
	topLeft: SQUARE,
	topRight: SQUARE,
	bottomRight: SQUARE,
	bottomLeft: SQUARE,
	leftSlant: 0,
	rightSlant: 0,
};

function shape(id: string): GraphicItemConfig {
	return {
		type: 'shape',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 100,
		height: 50,
		geometry: GEOMETRY,
	};
}

function group(id: string, children: string[]): GraphicGroupItemConfig {
	return {
		type: 'group',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 400,
		height: 200,
		arrangement: 'row',
		padding: 0,
		gap: 0,
		align: 'stretch',
		justify: 'start',
		clip: false,
		geometry: GEOMETRY,
		children: children.map(childId => shape(childId) as GraphicGroupItemConfig['children'][number]),
	};
}

function graphic(items: GraphicItemConfig[] = [shape('bar'), shape('name')]): BroadcastGraphicConfig {
	return { id: 'lower-third', name: 'Lower third', items };
}

function itemAnimation(next: BroadcastGraphicConfig, itemId: string) {
	return findGraphicItem(next, itemId)?.item.animation;
}

describe('graphic item animation authoring', () => {
	it('gives a newly authored Graphic Item no recipes until a phase is enabled', () => {
		const base = graphic();

		expect(itemAnimation(base, 'bar')).toBeUndefined();

		const enabled = enableGraphicItemAnimationPhase(base, 'bar', 'enter');

		expect(itemAnimation(enabled, 'bar')).toEqual({ enter: createDefaultGraphicAnimationRecipe('enter') });
	});

	it('drops the animation entirely when its last recipe is removed', () => {
		// "No recipes until enabled" has to stay a property of the stored shape, so
		// disabling the last phase leaves no empty animation object behind.
		const enabled = enableGraphicItemAnimationPhase(graphic(), 'bar', 'enter');
		const cleared = setGraphicItemAnimationRecipe(enabled, 'bar', 'enter', null);

		expect(itemAnimation(cleared, 'bar')).toBeUndefined();
	});

	it('owns at most one recipe per lifecycle phase, and enabling one leaves the others alone', () => {
		let next = enableGraphicItemAnimationPhase(graphic(), 'bar', 'enter');
		next = enableGraphicItemAnimationPhase(next, 'bar', 'exit');

		expect(Object.keys(itemAnimation(next, 'bar')!).toSorted()).toEqual(['enter', 'exit']);
	});

	it('merges one recipe field without dropping the recipe channels', () => {
		let next = enableGraphicItemAnimationPhase(graphic(), 'bar', 'enter');
		next = patchGraphicItemAnimationChannel(next, 'bar', 'enter', 'slide', { distance: 250 });
		next = patchGraphicItemAnimationRecipe(next, 'bar', 'enter', { duration: 900 });

		expect(itemAnimation(next, 'bar')?.enter).toMatchObject({
			duration: 900,
			fade: { opacity: 0 },
			slide: { direction: 'north', distanceMode: 'fixed', distance: 250 },
		});
	});

	it('merges one channel field without dropping the channel siblings', () => {
		let next = patchGraphicItemAnimationChannel(graphic(), 'bar', 'enter', 'scale', { factor: 0.5 });
		next = patchGraphicItemAnimationChannel(next, 'bar', 'enter', 'scale', { origin: 'bottom-left' });

		expect(itemAnimation(next, 'bar')?.enter?.scale).toEqual({ factor: 0.5, origin: 'bottom-left' });
	});

	it('removes one channel while keeping the rest of its recipe', () => {
		let next = patchGraphicItemAnimationChannel(graphic(), 'bar', 'enter', 'reveal', { edge: 'top' });
		next = patchGraphicItemAnimationChannel(next, 'bar', 'enter', 'fade', null);

		expect(itemAnimation(next, 'bar')?.enter).toMatchObject({ reveal: { edge: 'top' } });
		expect(itemAnimation(next, 'bar')?.enter?.fade).toBeUndefined();
	});

	it('initialises an editable recipe from a preset, recording nothing about the preset', () => {
		const next = applyGraphicItemAnimationPreset(graphic(), 'bar', 'enter', 'pop-in');
		const recipe = itemAnimation(next, 'bar')?.enter;

		expect(recipe).toMatchObject({ scale: { factor: 0.8, origin: 'center' }, easing: 'back-out' });

		// Editable: the next merge changes it like any other recipe.
		const edited = patchGraphicItemAnimationChannel(next, 'bar', 'enter', 'scale', { factor: 1.4 });
		expect(itemAnimation(edited, 'bar')?.enter?.scale?.factor).toBe(1.4);
	});

	it('ignores an unknown preset rather than clearing the recipe', () => {
		const enabled = enableGraphicItemAnimationPhase(graphic(), 'bar', 'enter');

		expect(applyGraphicItemAnimationPreset(enabled, 'bar', 'enter', 'nope')).toEqual(enabled);
	});

	it('never changes the Graphic Resting State of the item it animates', () => {
		const base = graphic();
		const before = findGraphicItem(base, 'bar')!.item;
		const next = applyGraphicItemAnimationPreset(base, 'bar', 'enter', 'slide-up-in');
		const after = findGraphicItem(next, 'bar')!.item;

		const { animation: _animation, ...restingAfter } = after;
		expect(restingAfter).toEqual(before);
	});

	it('never mutates the graphic it is given', () => {
		const base = graphic();
		const snapshot = structuredClone(base);

		enableGraphicItemAnimationPhase(base, 'bar', 'enter');

		expect(base).toEqual(snapshot);
	});
});

describe('stagger authoring', () => {
	it('staggers a selected subset of a Graphic Group direct items', () => {
		const base = graphic([group('cluster', ['one', 'two', 'three'])]);
		let next = patchGraphicItemAnimationStagger(base, 'cluster', 'enter', { step: 80 });
		next = toggleGraphicItemStaggerMember(next, 'cluster', 'enter', 'one', true);
		next = toggleGraphicItemStaggerMember(next, 'cluster', 'enter', 'three', true);

		expect(itemAnimation(next, 'cluster')?.stagger?.enter).toEqual({
			order: 'list',
			step: 80,
			itemIds: ['one', 'three'],
		});
	});

	it('reverses a stagger for one phase without touching another', () => {
		let next = patchBroadcastGraphicAnimationStagger([graphic()], 'lower-third', 'enter', {
			order: 'list',
			itemIds: ['bar', 'name'],
		});
		next = patchBroadcastGraphicAnimationStagger(next, 'lower-third', 'exit', {
			order: 'reverse-list',
			itemIds: ['bar', 'name'],
		});

		expect(next[0]?.animation?.stagger?.enter?.order).toBe('list');
		expect(next[0]?.animation?.stagger?.exit?.order).toBe('reverse-list');
	});

	it('keeps a stagger with no recipe of its own, because a container may only order its items', () => {
		const next = toggleBroadcastGraphicStaggerMember([graphic()], 'lower-third', 'enter', 'bar', true);

		expect(next[0]?.animation?.enter).toBeUndefined();
		expect(next[0]?.animation?.stagger?.enter?.itemIds).toEqual(['bar']);
	});

	it('drops the animation when the last stagger and recipe are both gone', () => {
		let next = toggleBroadcastGraphicStaggerMember([graphic()], 'lower-third', 'enter', 'bar', true);
		next = patchBroadcastGraphicAnimationStagger(next, 'lower-third', 'enter', null);

		expect(next[0]?.animation).toBeUndefined();
	});

	it('refuses a stagger on a Graphic Item that has no direct items of its own', () => {
		const next = patchGraphicItemAnimationStagger(graphic(), 'bar', 'enter', { step: 100 });

		expect(itemAnimation(next, 'bar')).toBeUndefined();
	});

	it('drops a deleted Graphic Item from every stagger subset that named it', () => {
		let next = patchBroadcastGraphicAnimationStagger([graphic()], 'lower-third', 'enter', {
			itemIds: ['bar', 'name'],
		});
		const deleted = deleteGraphicItem(next[0]!, 'name');

		expect(deleted.animation?.stagger?.enter?.itemIds).toEqual(['bar']);

		next = patchBroadcastGraphicAnimationStagger([deleted], 'lower-third', 'enter', { itemIds: ['bar'] });
		expect(deleteGraphicItem(next[0]!, 'bar').animation).toBeUndefined();
	});

	it('drops a deleted Graphic Group child from its group stagger subset', () => {
		const base = graphic([group('cluster', ['one', 'two'])]);
		const staggered = patchGraphicItemAnimationStagger(base, 'cluster', 'enter', { itemIds: ['one', 'two'] });
		const deleted = deleteGraphicItem(staggered, 'two');

		expect(itemAnimation(deleted, 'cluster')?.stagger?.enter?.itemIds).toEqual(['one']);
	});
});

describe('whole-graphic animation authoring', () => {
	it('enables and clears a whole-graphic phase over the Screen stack', () => {
		const stack = [graphic(), { id: 'bug', name: 'Bug', items: [] }];
		const enabled = enableBroadcastGraphicAnimationPhase(stack, 'lower-third', 'exit');

		expect(enabled[0]?.animation?.exit).toEqual(createDefaultGraphicAnimationRecipe('exit'));
		// Only the addressed Broadcast Graphic changes.
		expect(enabled[1]?.animation).toBeUndefined();

		const cleared = setBroadcastGraphicAnimationRecipe(enabled, 'lower-third', 'exit', null);
		expect(cleared[0]?.animation).toBeUndefined();
	});

	it('merges a whole-graphic recipe and its channels without dropping siblings', () => {
		let stack = applyBroadcastGraphicAnimationPreset([graphic()], 'lower-third', 'enter', 'slide-up-in');
		stack = patchBroadcastGraphicAnimationRecipe(stack, 'lower-third', 'enter', { easing: 'linear' });
		stack = patchBroadcastGraphicAnimationChannel(stack, 'lower-third', 'enter', 'slide', { distance: 999 });

		expect(stack[0]?.animation?.enter).toMatchObject({
			easing: 'linear',
			fade: { opacity: 0 },
			slide: { direction: 'south', distance: 999 },
		});
	});

	it('keeps an on-screen recipe repetition and pause through a merge', () => {
		let stack = enableBroadcastGraphicAnimationPhase([graphic()], 'lower-third', 'on-screen');
		stack = patchBroadcastGraphicAnimationRecipe(stack, 'lower-third', 'on-screen', { repeat: 4 });

		expect(stack[0]?.animation?.['on-screen']).toMatchObject({ repeat: 4, pause: 1000 });
	});

	it('leaves the authored items untouched, so a recipe never changes the resting composition', () => {
		const stack = [graphic()];
		const next = applyBroadcastGraphicAnimationPreset(stack, 'lower-third', 'enter', 'fade-in');

		expect(next[0]?.items).toEqual(stack[0]?.items);
	});
});
