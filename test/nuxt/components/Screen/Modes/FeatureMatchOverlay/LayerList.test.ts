import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { addGraphicGroupChild, addGraphicItem, findGraphicItem, patchGraphicItem } from '~~/shared/modules/graphics';
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
					v-for="entry in group.flatMap(entry => entry.children ?? [entry]).filter(entry => entry.onSelect)"
					:key="entry.label"
					type="button"
					:data-menu-entry="entry.label"
					:data-menu-description="entry.description"
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

	describe('dragging a row (#741)', () => {
		type Wrapper = Awaited<ReturnType<typeof mountList>>['wrapper'];

		function rowElement(wrapper: Wrapper, key: string) {
			return wrapper.get(`[data-layer-key="${key}"]`).element as HTMLElement;
		}

		/** Dispatch a drag event on a row; answers whether the row took the drop (the event was cancelled). */
		async function dragOn(wrapper: Wrapper, type: string, key: string, fraction = 0) {
			const element = rowElement(wrapper, key);
			// Layout is the boundary: each row is 20px tall at the top of the viewport.
			element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 20 });
			const event = new DragEvent(type, {
				bubbles: true,
				cancelable: true,
				dataTransfer: new DataTransfer(),
			});
			// happy-dom's DragEvent takes no pointer position.
			Object.defineProperty(event, 'clientY', { value: fraction * 20 });
			element.dispatchEvent(event);
			await wrapper.vm.$nextTick();
			return event.defaultPrevented;
		}

		function dropEdges(wrapper: Wrapper) {
			return Object.fromEntries(wrapper.findAll('[data-testid="layer-row"][data-drop-edge]')
				.map(row => [
					row.attributes('data-layer-key'),
					row.attributes('data-drop-edge'),
				]));
		}

		type Config = Awaited<ReturnType<typeof mountList>>['config'];

		function itemIds(config: Config) {
			return config.value.layout.composition.items.map(item => item.id);
		}

		function parentOf(config: Config, id: string) {
			return findGraphicItem(config.value.layout.composition, id)?.group?.id ?? null;
		}

		function rotateBack(config: Config) {
			const composition = patchGraphicItem(config.value.layout.composition, 'back', { rotation: 15 });
			config.value = {
				...config.value,
				layout: { ...config.value.layout, composition },
			};
		}

		it.each<[string, number, string, string[], string[], string | null]>([
			[
				'in front of the group',
				0.1,
				'top',
				['cluster', 'back'],
				['item:back', 'item:cluster', 'item:child'],
				null,
			],
			[
				'into the group',
				0.6,
				'inside',
				['cluster'],
				['item:cluster', 'item:back', 'item:child'],
				'cluster',
			],
		])('drops a row %s, showing where it lands, as one undo step', async (_case, fraction, edge, items, rows, parent) => {
			const { wrapper, config, editor, sync } = await mountList();

			await dragOn(wrapper, 'dragstart', 'item:back');
			expect(wrapper.get('[data-layer-key="item:back"]').attributes('data-dragging')).toBe('true');
			expect(await dragOn(wrapper, 'dragover', 'item:cluster', fraction)).toBe(true);
			expect(dropEdges(wrapper)).toEqual({ 'item:cluster': edge });
			await dragOn(wrapper, 'drop', 'item:cluster', fraction);
			await sync();

			expect(itemIds(config)).toEqual(items);
			expect(parentOf(config, 'back')).toBe(parent);
			expect(rowKeys(wrapper).slice(0, 3)).toEqual(rows);
			expect(dropEdges(wrapper)).toEqual({});
			expect(editor.selection.value).toEqual({ type: 'item', itemId: 'back' });
			editor.undo();
			expect(itemIds(config)).toEqual(['back', 'cluster']);
			expect(editor.canUndo.value).toBe(false);
		});

		// Escape ends a native drag with a dragend and no drop.
		it('cancels on Escape: the indicator goes and nothing is written', async () => {
			const { wrapper, config, editor } = await mountList();
			const before = config.value;

			await dragOn(wrapper, 'dragstart', 'item:back');
			await dragOn(wrapper, 'dragover', 'item:cluster', 0.1);
			await dragOn(wrapper, 'dragend', 'item:back');

			expect(dropEdges(wrapper)).toEqual({});
			expect(wrapper.find('[data-dragging]').exists()).toBe(false);
			expect(config.value).toBe(before);
			expect(editor.canUndo.value).toBe(false);
		});

		it('refuses a rotated item into a row group, saying why, and drops nothing', async () => {
			const { wrapper, config, sync } = await mountList();
			rotateBack(config);
			await sync();
			const before = config.value;

			await dragOn(wrapper, 'dragstart', 'item:back');
			expect(await dragOn(wrapper, 'dragover', 'item:cluster', 0.6)).toBe(false);
			expect(wrapper.get('[data-layer-key="item:cluster"]').attributes('data-drop-refused')).toBe('true');
			expect(wrapper.get('[data-testid="layer-drop-refusal"]').text()).toContain('rotated');
			await dragOn(wrapper, 'drop', 'item:cluster', 0.6);

			expect(config.value).toBe(before);
		});

		it('lands a release in the gap after the row whose drop it last showed', async () => {
			const { wrapper, config } = await mountList();

			await dragOn(wrapper, 'dragstart', 'item:back');
			await dragOn(wrapper, 'dragover', 'item:cluster', 0.1);
			const grid = wrapper.get('[data-layer-key="item:cluster"]').element.parentElement!;
			grid.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));

			expect(itemIds(config)).toEqual(['cluster', 'back']);
		});

		// Such a row fires no dragend.
		it('ends a drag whose row leaves the list', async () => {
			const { wrapper, editor, sync } = await mountList();

			await dragOn(wrapper, 'dragstart', 'item:child');
			editor.remove({ type: 'item', itemId: 'child' });
			await sync();
			editor.undo();
			await sync();

			expect(wrapper.find('[data-dragging]').exists()).toBe(false);
		});

		it('drags nothing without the Graphics Authoring Lease', async () => {
			const { wrapper, config } = await mountList({ writable: false });
			const before = config.value;

			expect(wrapper.get('[data-layer-key="item:back"]').attributes('draggable')).toBe('false');
			await dragOn(wrapper, 'dragstart', 'item:back');
			expect(await dragOn(wrapper, 'dragover', 'item:cluster', 0.1)).toBe(false);
			await dragOn(wrapper, 'drop', 'item:cluster', 0.1);

			expect(config.value).toBe(before);
		});

		// The keyboard reaches a group through the row menu, as a drag does.
		it('moves a Graphic Item into a group and out again from its row menu, one undo step each', async () => {
			const { wrapper, config, editor, sync } = await mountList();

			await wrapper.get('[data-layer-key="item:back"] [data-menu-entry="Group 1"]').trigger('click');
			await sync();
			expect(parentOf(config, 'back')).toBe('cluster');

			await wrapper.get('[data-layer-key="item:back"] [data-menu-entry="Out of Group 1"]').trigger('click');
			await sync();
			expect(itemIds(config)).toEqual(['cluster', 'back']);

			editor.undo();
			expect(parentOf(config, 'back')).toBe('cluster');
		});

		it('offers a rotated item no row group from its row menu, saying why', async () => {
			const { wrapper, config, sync } = await mountList();
			rotateBack(config);
			await sync();

			const entry = wrapper.get('[data-layer-key="item:back"] [data-menu-entry="Group 1"]');

			expect(entry.attributes('disabled')).toBeDefined();
			expect(entry.attributes('data-menu-description')).toContain('rotated');
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
