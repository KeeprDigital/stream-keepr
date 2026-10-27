import type { BroadcastGraphicConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { CompositorEdit, CompositorEditingState } from '~/modules/graphics/compositorEditing';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import {
	createBroadcastGraphic,
	DEFAULT_GRAPHIC_TYPOGRAPHY,
	moveBroadcastGraphic,
	patchBroadcastGraphic,
	patchGraphicItem,
	patchGraphicTypography,
	resolveGraphicThemeTokens,
} from '~~/shared/modules/graphics';
import { editCompositorStack, useCompositorEditing } from '~/modules/graphics/compositorEditing';

const textItem: GraphicItemConfig = {
	type: 'text',
	id: 'name',
	label: 'Text 1',
	visible: true,
	anchor: 'top-left',
	x: 0,
	y: 0,
	width: 400,
	height: 80,
	text: 'Commentator',
	typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
	overflowPolicy: 'ellipsis',
	minFontSize: 24,
};

function stack(): BroadcastGraphicConfig[] {
	return [
		{
			id: 'lower-third',
			name: 'Lower Third',
			items: [textItem],
		},
		{ id: 'bug', name: 'Bug', items: [] },
	];
}

const ITEM = { type: 'item', graphicId: 'lower-third', itemId: 'name' } as const;
const GRAPHIC = { type: 'graphic', graphicId: 'lower-third' } as const;
const CANVAS = { type: 'canvas' } as const;

function state(overrides: Partial<CompositorEditingState> = {}): CompositorEditingState {
	return {
		graphics: stack(),
		selectedTarget: ITEM,
		writable: true,
		...overrides,
	};
}

const setFontSize: CompositorEdit = {
	kind: 'author',
	item: (graphic, itemId) => patchGraphicTypography(graphic, itemId, { fontSize: 30 }),
};

const rename: CompositorEdit = {
	kind: 'author',
	graphic: (graphics, graphicId) => patchBroadcastGraphic(graphics, graphicId, { name: 'Talent' }),
};

function fontSizeOf(graphics: readonly BroadcastGraphicConfig[] | null) {
	const item = graphics?.[0]?.items[0];
	return item?.type === 'text'
		? item.typography.fontSize
		: undefined;
}

describe('the Graphics Authoring Lease', () => {
	it('refuses every edit while this Session does not hold it', () => {
		const refused = state({ writable: false });

		expect(editCompositorStack(refused, setFontSize)).toBeNull();
		expect(editCompositorStack({ ...refused, selectedTarget: GRAPHIC }, rename)).toBeNull();
		expect(editCompositorStack(refused, { kind: 'bind-theme-token', slot: 'typography.color', token: 'text-primary' })).toBeNull();
		expect(editCompositorStack(refused, { kind: 'detach-theme-token', slot: 'typography.color' })).toBeNull();
	});

	it('fails closed when nothing states that this Session holds it', () => {
		expect(editCompositorStack(state({ writable: undefined }), setFontSize)).toBeNull();
	});

	it('admits the edit while this Session holds it', () => {
		expect(fontSizeOf(editCompositorStack(state(), setFontSize))).toBe(30);
	});
});

describe('resolving the selection', () => {
	it('aims an item edit at the selected Graphic Item', () => {
		expect(fontSizeOf(editCompositorStack(state(), setFontSize))).toBe(30);
	});

	it('aims a graphic edit at the selected Broadcast Graphic', () => {
		expect(editCompositorStack(state({ selectedTarget: GRAPHIC }), rename)?.[0]?.name).toBe('Talent');
	});

	it('refuses an edit that has nothing to say about what is selected', () => {
		expect(editCompositorStack(state({ selectedTarget: GRAPHIC }), setFontSize)).toBeNull();
		expect(editCompositorStack(state(), rename)).toBeNull();
		expect(editCompositorStack(state({ selectedTarget: CANVAS }), setFontSize)).toBeNull();
	});

	it('refuses an edit to a selection the stack no longer carries', () => {
		const gone = { type: 'item', graphicId: 'lower-third', itemId: 'deleted' } as const;

		expect(editCompositorStack(state({ selectedTarget: gone }), setFontSize)).toBeNull();
	});
});

describe('editing the stack whatever is selected', () => {
	const addGraphic: CompositorEdit = {
		kind: 'stack',
		apply: graphics => createBroadcastGraphic(graphics, { id: 'scorebug', name: 'Scorebug' }).graphics,
	};

	it('applies a stack edit with anything or nothing selected', () => {
		for (const selectedTarget of [ITEM, GRAPHIC, CANVAS]) {
			expect(editCompositorStack(state({ selectedTarget }), addGraphic)?.map(graphic => graphic.id))
				.toEqual(['lower-third', 'bug', 'scorebug']);
		}
	});

	it('applies a stack edit even after the selection has gone', () => {
		const gone = { type: 'graphic', graphicId: 'deleted' } as const;

		expect(editCompositorStack(state({ selectedTarget: gone }), addGraphic)).toHaveLength(3);
	});

	it('still refuses a stack edit while this Session does not hold the lease', () => {
		expect(editCompositorStack(state({ writable: false, selectedTarget: CANVAS }), addGraphic)).toBeNull();
	});
});

describe('editing one named Broadcast Graphic whatever is selected', () => {
	function hide(graphicId: string): CompositorEdit {
		return {
			kind: 'named-graphic',
			graphicId,
			apply: graphic => ({ ...graphic, name: `${graphic.name} (hidden)` }),
		};
	}

	it('applies to the Broadcast Graphic it names, with anything or nothing selected', () => {
		for (const selectedTarget of [ITEM, GRAPHIC, CANVAS]) {
			expect(editCompositorStack(state({ selectedTarget }), hide('bug'))?.map(graphic => graphic.name))
				.toEqual(['Lower Third', 'Bug (hidden)']);
		}
	});

	it('refuses to edit a Broadcast Graphic the stack does not carry', () => {
		expect(editCompositorStack(state(), hide('deleted'))).toBeNull();
	});

	it('still refuses while this Session does not hold the lease', () => {
		expect(editCompositorStack(state({ writable: false }), hide('bug'))).toBeNull();
	});
});

describe('replacing the stack', () => {
	it('replaces only the edited Broadcast Graphic, in place', () => {
		const before = state();
		const next = editCompositorStack(before, setFontSize);

		expect(next?.map(graphic => graphic.id)).toEqual(['lower-third', 'bug']);
		expect(next?.[1]).toBe(before.graphics[1]);
	});

	it('answers nothing to commit for an edit that changes nothing', () => {
		const frontmostForward: CompositorEdit = {
			kind: 'stack',
			apply: graphics => moveBroadcastGraphic(graphics, 'bug', 1),
		};
		const unchanged: CompositorEdit = {
			kind: 'named-graphic',
			graphicId: 'bug',
			apply: graphic => graphic,
		};

		expect(editCompositorStack(state(), frontmostForward)).toBeNull();
		expect(editCompositorStack(state(), unchanged)).toBeNull();
	});

	it('never changes the stack it was given', () => {
		const before = state();
		editCompositorStack(before, setFontSize);

		expect(before.graphics).toEqual(stack());
	});
});

describe('a panel editing through the module', () => {
	it('commits each admitted edit, starting from the stack the panel shows now', () => {
		const current = ref(state());
		const committed: BroadcastGraphicConfig[][] = [];
		const { editItem } = useCompositorEditing(current, graphics => committed.push(graphics));

		editItem(patchGraphicTypography, { fontSize: 30 });
		current.value = { ...current.value, graphics: committed[0]! };
		editItem(patchGraphicItem, { label: 'Talent' });

		expect(committed).toHaveLength(2);
		expect(fontSizeOf(committed[1]!)).toBe(30);
		expect(committed[1]![0]!.items[0]!.label).toBe('Talent');
	});

	it('says whether it committed, so a panel moves the selection only after an admitted edit', () => {
		const writable = ref(true);
		const committed: BroadcastGraphicConfig[][] = [];
		const { edit } = useCompositorEditing(() => state({ writable: writable.value }), graphics => committed.push(graphics));
		const remove: CompositorEdit = {
			kind: 'stack',
			apply: graphics => graphics.filter(graphic => graphic.id !== 'bug'),
		};

		expect(edit(remove)).toBe(true);
		writable.value = false;
		expect(edit(remove)).toBe(false);
		expect(committed).toHaveLength(1);
	});

	it('commits nothing for a refused edit', () => {
		const committed: BroadcastGraphicConfig[][] = [];
		const editing = useCompositorEditing(() => state({ writable: false }), graphics => committed.push(graphics));

		editing.editItem(patchGraphicTypography, { fontSize: 30 });
		editing.editGraphic(patchBroadcastGraphic, { name: 'Talent' });
		editing.detachThemeToken('typography.color');

		expect(editing.canAuthor.value).toBe(false);
		expect(committed).toEqual([]);
	});
});

describe('binding a Foundation Token', () => {
	const tokens = resolveGraphicThemeTokens({ 'text-primary': 'rgb(1, 2, 3)' });
	const bound = (): BroadcastGraphicConfig[] => [
		{
			...stack()[0]!,
			items: [
				{
					...textItem,
					themeBindings: { 'typography.color': 'text-primary' },
				},
			],
		},
		stack()[1]!,
	];

	function itemOf(graphics: readonly BroadcastGraphicConfig[] | null) {
		const item = graphics?.[0]?.items[0];
		return item?.type === 'text'
			? item
			: undefined;
	}

	it('binds the selected owner\'s slot, replacing its value with the token\'s', () => {
		const next = editCompositorStack(state({ themeTokens: tokens }), { kind: 'bind-theme-token', slot: 'typography.color', token: 'text-primary' });

		expect(itemOf(next)?.themeBindings).toEqual({ 'typography.color': 'text-primary' });
		expect(itemOf(next)?.typography.color).toBe('rgb(1, 2, 3)');
	});

	it('detaches a slot, keeping the value the preview resolves it to', () => {
		const next = editCompositorStack(state({
			graphics: bound(),
			themeTokens: tokens,
		}), { kind: 'detach-theme-token', slot: 'typography.color' });

		expect(itemOf(next)?.themeBindings).toBeUndefined();
		expect(itemOf(next)?.typography.color).toBe('rgb(1, 2, 3)');
	});

	it.each([
		[
			'an edit to the bound value releases it',
			{ color: '#00ff00' },
			undefined,
		],
		[
			'an edit to a value the token does not own keeps it',
			{ fontSize: 30 },
			{ 'typography.color': 'text-primary' },
		],
	])('%s', (_, patch, kept) => {
		const next = editCompositorStack(state({
			graphics: bound(),
			themeTokens: tokens,
		}), {
			kind: 'author',
			item: (graphic, itemId) => patchGraphicTypography(graphic, itemId, patch),
		});

		expect(itemOf(next)?.themeBindings).toEqual(kept);
	});

	it('returns a graphic the edit left alone as it was stored', () => {
		const before = state({
			graphics: bound(),
			themeTokens: tokens,
			selectedTarget: { type: 'graphic', graphicId: 'bug' },
		});
		const next = editCompositorStack(before, rename);

		expect(next?.[0]).toBe(before.graphics[0]);
	});
});
