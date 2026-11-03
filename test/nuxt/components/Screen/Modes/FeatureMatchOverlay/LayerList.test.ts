import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import LayerList from '~/components/Screen/Modes/FeatureMatchOverlay/LayerList.vue';
import { useFeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';

/**
 * The Feature Match Layout's one layer list: Graphic Items, then Source Items,
 * then the canvas — front to back, the order they composite in.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

const UButtonStub = defineComponent({
	props: {
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

/** Every menu entry, a submenu's included, as a plain button, so the menu needs no opening. */
const UDropdownMenuStub = defineComponent({
	props: {
		items: { type: Array, required: true },
	},
	template: `
		<div>
			<slot />
			<template v-for="(group, groupIndex) in items" :key="groupIndex">
				<button
					v-for="entry in group.flatMap(entry => entry.children ? entry.children.flat() : [entry]).filter(entry => entry.onSelect)"
					:key="entry.label"
					type="button"
					:data-menu-entry="entry.label"
					:disabled="entry.disabled"
					@click="entry.onSelect()"
				>{{ entry.label }}</button>
			</template>
		</div>
	`,
});

function configWithItems(): FeatureMatchOverlayModeConfig {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	let composition: BroadcastGraphicConfig = { ...config.layout.composition, items: [] };
	composition = addGraphicItem(composition, { kind: 'shape', id: 'back', ...CANVAS }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'cluster', id: 'child' }).graphic;
	return {
		...config,
		layout: { ...config.layout, composition },
	};
}

async function mountList({ writable = true } = {}) {
	const config = ref(configWithItems());
	const updateConfig = (patch: Partial<FeatureMatchOverlayModeConfig>) => {
		config.value = {
			...config.value,
			...patch,
		};
	};
	const editor = useFeatureMatchLayoutEditor({
		config,
		updateConfig,
		canvasWidth: 1920,
		canvasHeight: 1080,
		writable,
	});
	const wrapper = mount(LayerList, {
		props: {
			layout: config.value.layout,
			editor,
			canvasWidth: 1920,
			canvasHeight: 1080,
		},
		global: {
			stubs: {
				UButton: UButtonStub,
				UDropdownMenu: UDropdownMenuStub,
				UIcon: true,
			},
		},
	});
	const sync = async () => {
		await wrapper.setProps({ layout: config.value.layout });
	};
	return { wrapper, config, editor, sync };
}

function rowKeys(wrapper: Awaited<ReturnType<typeof mountList>>['wrapper']) {
	return wrapper.findAll('[data-testid="layer-row"]').map(row => row.attributes('data-layer-key'));
}

describe('featureMatchOverlayLayerList', () => {
	it('lists Graphic Items front to back with each group\'s children beneath it, then the Sources, then the canvas', async () => {
		const { wrapper, config } = await mountList();

		const sources = [...config.value.layout.sources].reverse().map(item => `source:${item.id}`);
		expect(rowKeys(wrapper)).toEqual([
			'item:cluster',
			'item:child',
			'item:back',
			...sources,
		]);
		expect(wrapper.find('[data-testid="layer-canvas"]').exists()).toBe(true);
	});

	function selectedKeys(wrapper: Awaited<ReturnType<typeof mountList>>['wrapper']) {
		return wrapper.findAll('[data-testid="layer-row"][aria-selected="true"]').map(row => row.attributes('data-layer-key'));
	}

	it('marks the selected rows, and the canvas only while no layer is selected', async () => {
		const { wrapper } = await mountList();
		expect(wrapper.get('[data-testid="layer-canvas"]').attributes('aria-current')).toBe('true');
		expect(selectedKeys(wrapper)).toEqual([]);

		await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-select"]').trigger('click');

		expect(selectedKeys(wrapper)).toEqual(['item:back']);
		expect(wrapper.findAll('[data-testid="layer-row"][aria-selected="false"]').length).toBeGreaterThan(0);
		expect(wrapper.get('[data-testid="layer-canvas"]').attributes('aria-current')).toBeUndefined();
	});

	// #740: which click builds the selection how. What it then holds is layerSelection's rule.
	it.each<[string, Array<[string, KeyboardEventInit]>, (sources: string[]) => string[]]>([
		[
			'⌘-click adds a row',
			[
				['item:back', {}],
				[
					'source:main-source',
					{ metaKey: true },
				],
			],
			() => ['item:back', 'source:main-source'],
		],
		[
			'Ctrl-click adds a row',
			[
				['item:back', {}],
				[
					'item:cluster',
					{ ctrlKey: true },
				],
			],
			() => ['item:cluster', 'item:back'],
		],
		[
			'Shift-click selects every row from the last one chosen',
			[
				['item:child', {}],
				[
					'source:main-source',
					{ shiftKey: true },
				],
			],
			sources => [
				'item:child',
				'item:back',
				...sources.slice(0, sources.indexOf('source:main-source') + 1),
			],
		],
		[
			'a plain click selects that row alone',
			[
				['item:back', {}],
				[
					'item:cluster',
					{ metaKey: true },
				],
				['item:child', {}],
			],
			() => ['item:child'],
		],
	])('%s', async (_, clicks, expected) => {
		const { wrapper, config } = await mountList();

		for (const [key, modifiers] of clicks)
			await wrapper.get(`[data-layer-key="${key}"] [data-testid="layer-select"]`).trigger('click', modifiers);

		const sources = [...config.value.layout.sources].reverse().map(item => `source:${item.id}`);
		expect(selectedKeys(wrapper)).toEqual(expected(sources));
	});

	// A selected row among several speaks for the selection: `added` rows appear, and `visible` is the pair's visibility after.
	it.each<[string, string, (rows: string[]) => string[], number, Array<boolean | undefined>]>([
		[
			'Delete in its menu',
			'[data-menu-entry="Delete"]',
			rows => rows.filter(key => key !== 'item:back' && key !== 'source:main-source'),
			0,
			[undefined, undefined],
		],
		[
			'Duplicate in its menu',
			'[data-menu-entry="Duplicate"]',
			rows => rows,
			2,
			[true, true],
		],
		[
			'its eye',
			'[data-testid="layer-visibility"]',
			rows => rows,
			0,
			[false, false],
		],
	])('%s acts on every selected layer', async (_, control, kept, added, visible) => {
		const { wrapper, config, sync } = await mountList();
		const before = rowKeys(wrapper) as string[];
		await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-select"]').trigger('click');
		await wrapper.get('[data-layer-key="source:main-source"] [data-testid="layer-select"]').trigger('click', { metaKey: true });

		await wrapper.get(`[data-layer-key="item:back"] ${control}`).trigger('click');
		await sync();

		expect(rowKeys(wrapper)).toEqual(expect.arrayContaining(kept(before)));
		expect(rowKeys(wrapper)).toHaveLength(kept(before).length + added);
		expect(selectedKeys(wrapper).filter(key => !before.includes(key!))).toHaveLength(added);
		expect([
			config.value.layout.composition.items.find(item => item.id === 'back')?.visible,
			config.value.layout.sources.find(item => item.id === 'main-source')?.visible,
		]).toEqual(visible);
	});

	// #919. Player 1's Source is 340×250 at (24, 16), Player 2's at (24, 800), and the main Source 1500×900 at (400, 90).
	it.each<[string, string[], string, string, Record<string, { x: number; y: number }>]>([
		[
			'Align › Right in a selected row\'s menu aligns the selection to its bounds',
			['source:player2-source', 'source:main-source'],
			'source:player2-source',
			'Right',
			{
				'player2-source': { x: 1560, y: 800 },
				'main-source': { x: 400, y: 90 },
			},
		],
		[
			'Align › Left in another row\'s menu aligns that row alone to the canvas',
			['source:player2-source', 'source:main-source'],
			'source:player1-source',
			'Left',
			{
				'player1-source': { x: 0, y: 16 },
				'player2-source': { x: 24, y: 800 },
			},
		],
		[
			'Distribute › Vertically in a selected row\'s menu spaces the selection',
			['source:player1-source', 'source:main-source', 'source:player2-source'],
			'source:main-source',
			'Vertically',
			{
				'player1-source': { x: 24, y: 16 },
				'main-source': { x: 400, y: 83 },
				'player2-source': { x: 24, y: 800 },
			},
		],
	])('%s', async (_, selecting, row, entry, placed) => {
		const { wrapper, config } = await mountList();
		for (const [index, key] of selecting.entries())
			await wrapper.get(`[data-layer-key="${key}"] [data-testid="layer-select"]`).trigger('click', { metaKey: index > 0 });

		await wrapper.get(`[data-layer-key="${row}"] [data-menu-entry="${entry}"]`).trigger('click');

		expect(Object.fromEntries(Object.keys(placed).map((id) => {
			const source = config.value.layout.sources.find(item => item.id === id)!;
			return [
				id,
				{ x: source.x, y: source.y },
			];
		}))).toEqual(placed);
	});

	it('moves a row toward the front with the arrow pointing up', async () => {
		const { wrapper, config, sync } = await mountList();
		const back = wrapper.get('[data-layer-key="item:back"]');

		expect(back.get('[data-testid="layer-backward"]').attributes('disabled')).toBeDefined();
		await back.get('[data-testid="layer-forward"]').trigger('click');
		await sync();

		expect(config.value.layout.composition.items.map(item => item.id)).toEqual(['cluster', 'back']);
		expect(rowKeys(wrapper).slice(0, 3)).toEqual(['item:back', 'item:cluster', 'item:child']);
	});

	it('hides and shows a layer from its row', async () => {
		const { wrapper, config } = await mountList();

		await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-visibility"]').trigger('click');

		expect(config.value.layout.composition.items.find(item => item.id === 'back')?.visible).toBe(false);
	});

	it('adds a Source Item from the Add menu and selects it', async () => {
		const { wrapper, config, editor } = await mountList();
		const before = config.value.layout.sources.length;

		await wrapper.get('[data-menu-entry="Source Item"]').trigger('click');

		expect(config.value.layout.sources).toHaveLength(before + 1);
		expect(editor.selection.value).toEqual({ type: 'source', itemId: config.value.layout.sources.at(-1)!.id });
	});

	it('offers to add into the Graphic Group the selection sits in', async () => {
		const { wrapper, editor, config } = await mountList();
		const textEntries = () => wrapper.findAll('[data-menu-entry="Text"]');
		expect(textEntries()).toHaveLength(1);

		editor.select({ type: 'item', itemId: 'child' });
		await wrapper.vm.$nextTick();
		expect(textEntries()).toHaveLength(2);

		await textEntries()[1]!.trigger('click');

		const cluster = config.value.layout.composition.items.find(item => item.id === 'cluster');
		expect(cluster?.type === 'group' && cluster.children).toHaveLength(2);
	});

	describe('renaming a layer inline', () => {
		function itemLabel(config: Awaited<ReturnType<typeof mountList>>['config'], id: string) {
			return config.value.layout.composition.items.find(item => item.id === id)?.label;
		}

		it('renames a Graphic Item on double-click, trimmed, as one undo step', async () => {
			const { wrapper, config, editor, sync } = await mountList();
			const before = itemLabel(config, 'back');

			await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-select"]').trigger('dblclick');
			const input = wrapper.get('[data-layer-key="item:back"] [data-testid="layer-rename"]');
			expect((input.element as HTMLInputElement).value).toBe(before);
			await input.setValue('  Lower third  ');
			await input.trigger('keydown', { key: 'Enter' });
			await sync();

			expect(itemLabel(config, 'back')).toBe('Lower third');
			expect(wrapper.find('[data-testid="layer-rename"]').exists()).toBe(false);
			expect(wrapper.get('[data-layer-key="item:back"]').text()).toContain('Lower third');

			editor.undo();
			expect(itemLabel(config, 'back')).toBe(before);
			expect(editor.canUndo.value).toBe(false);
		});

		it('renames a Source Item from F2 on its row, committing on blur, as one undo step', async () => {
			const { wrapper, config, editor, sync } = await mountList();
			const source = config.value.layout.sources[0]!;
			const row = `[data-layer-key="source:${source.id}"]`;

			await wrapper.get(`${row} [data-testid="layer-select"]`).trigger('keydown', { key: 'F2' });
			const input = wrapper.get(`${row} [data-testid="layer-rename"]`);
			await input.setValue('Player 1 feed');
			await input.trigger('blur');
			await sync();

			expect(config.value.layout.sources[0]!.label).toBe('Player 1 feed');
			editor.undo();
			expect(config.value.layout.sources[0]!.label).toBe(source.label);
			expect(editor.canUndo.value).toBe(false);
		});

		it('waits out an input method\'s composition before Enter commits', async () => {
			const { wrapper, config } = await mountList();
			const before = itemLabel(config, 'back');

			await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-select"]').trigger('dblclick');
			const input = wrapper.get('[data-testid="layer-rename"]');
			await input.setValue('ロゴ');
			await input.trigger('keydown', { key: 'Enter', isComposing: true });

			expect(wrapper.find('[data-testid="layer-rename"]').exists()).toBe(true);
			expect(itemLabel(config, 'back')).toBe(before);
		});

		it('drops a rename whose row leaves the list, so the row comes back as a button', async () => {
			const { wrapper, editor, sync } = await mountList();

			await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-select"]').trigger('dblclick');
			editor.remove({ type: 'item', itemId: 'back' });
			await sync();
			editor.undo();
			await sync();

			expect(wrapper.find('[data-testid="layer-rename"]').exists()).toBe(false);
			expect(wrapper.find('[data-layer-key="item:back"] [data-testid="layer-select"]').exists()).toBe(true);
		});

		it('selects on Enter, and renames on Enter once the row is selected', async () => {
			const { wrapper, editor } = await mountList();
			const button = () => wrapper.get('[data-layer-key="item:back"] [data-testid="layer-select"]');

			await button().trigger('keydown', { key: 'Enter' });
			expect(wrapper.find('[data-testid="layer-rename"]').exists()).toBe(false);
			editor.select({ type: 'item', itemId: 'back' });
			await wrapper.vm.$nextTick();

			await button().trigger('keydown', { key: 'Enter' });

			expect(wrapper.find('[data-layer-key="item:back"] [data-testid="layer-rename"]').exists()).toBe(true);
		});

		it('keeps the old name when the rename is cancelled with Escape or left blank', async () => {
			const { wrapper, config, editor } = await mountList();
			const before = itemLabel(config, 'back');
			const button = '[data-layer-key="item:back"] [data-testid="layer-select"]';

			await wrapper.get(button).trigger('dblclick');
			await wrapper.get('[data-testid="layer-rename"]').setValue('Discarded');
			await wrapper.get('[data-testid="layer-rename"]').trigger('keydown', { key: 'Escape' });
			expect(wrapper.find('[data-testid="layer-rename"]').exists()).toBe(false);
			expect(itemLabel(config, 'back')).toBe(before);

			await wrapper.get(button).trigger('dblclick');
			await wrapper.get('[data-testid="layer-rename"]').setValue('   ');
			await wrapper.get('[data-testid="layer-rename"]').trigger('keydown', { key: 'Enter' });

			expect(itemLabel(config, 'back')).toBe(before);
			expect(editor.canUndo.value).toBe(false);
		});

		it('keeps the keys typed into the name away from the editor\'s shortcuts', async () => {
			const { wrapper } = await mountList();
			const reachedEditor: string[] = [];
			wrapper.element.addEventListener('keydown', (event: KeyboardEvent) => reachedEditor.push(event.key));

			await wrapper.get('[data-layer-key="item:back"] [data-testid="layer-select"]').trigger('dblclick');
			const input = wrapper.get('[data-testid="layer-rename"]');
			await input.trigger('keydown', { key: 'Backspace' });
			await input.trigger('keydown', { key: 'z', metaKey: true });
			await input.trigger('keydown', { key: 'Escape' });

			expect(reachedEditor).toEqual([]);
		});
	});

	// A session observing another's Graphics Authoring Lease selects, but edits nothing (#738).
	it('offers an observer selection only', async () => {
		const { wrapper, editor } = await mountList({ writable: false });
		const row = '[data-layer-key="item:back"]';

		await wrapper.get(`${row} [data-testid="layer-select"]`).trigger('click');
		await wrapper.get(`${row} [data-testid="layer-select"]`).trigger('dblclick');

		expect(editor.selection.value).toEqual({ type: 'item', itemId: 'back' });
		expect(wrapper.find('[data-testid="layer-rename"]').exists()).toBe(false);
		expect(wrapper.findAll('[data-testid="feature-match-layer-list"] button:not([disabled])')
			.map(button => button.attributes('data-testid'))
			.filter(id => id !== 'layer-select' && id !== 'layer-canvas')).toEqual([]);
	});
});
