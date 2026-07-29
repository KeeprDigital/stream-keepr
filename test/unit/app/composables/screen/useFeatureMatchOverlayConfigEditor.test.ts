import type { FeatureMatchLayoutItemConfig, FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useFeatureMatchOverlayConfigEditor } from '~~/app/composables/screen/useFeatureMatchOverlayConfigEditor';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

// Layout mutation semantics live in the pure writer and are covered by
// test/unit/app/modules/featureMatchOverlayLayout.test.ts. This suite only
// checks the binding: id-addressed verbs submit the whole updated layout
// through updateConfig, no-ops submit nothing, and geometry input parsing
// uses the screen dimensions.

function graphicItemItem(overrides: Partial<Extract<FeatureMatchLayoutItemConfig, { type: 'graphic-item' }>> = {}): FeatureMatchLayoutItemConfig {
	return {
		id: 'w1',
		type: 'graphic-item',
		label: 'GraphicItem',
		visible: true,
		x: 100,
		y: 50,
		width: 100,
		height: 40,
		graphicItem: { type: 'clock' },
		...overrides,
	};
}

function createEditor(items: FeatureMatchLayoutItemConfig[]) {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	const config = ref<FeatureMatchOverlayModeConfig>({ ...base, layout: { ...base.layout, items } });
	const updateConfig = vi.fn((partial: Partial<FeatureMatchOverlayModeConfig>) => {
		config.value = { ...config.value, ...partial };
	});
	const editor = useFeatureMatchOverlayConfigEditor({
		config,
		updateConfig,
		screenWidth: ref(1920),
		screenHeight: ref(1080),
	});
	return { config, updateConfig, editor };
}

describe('useFeatureMatchOverlayConfigEditor', () => {
	it('submits the whole updated layout for an id-addressed item patch', () => {
		const { config, updateConfig, editor } = createEditor([graphicItemItem()]);

		editor.updateItem('w1', { label: 'Renamed' });

		expect(updateConfig).toHaveBeenCalledOnce();
		expect(updateConfig.mock.calls[0]![0]).toEqual({ layout: config.value.layout });
		expect(config.value.layout.items[0]!.label).toBe('Renamed');
	});

	it('submits nothing when the mutation cannot apply', () => {
		const { updateConfig, editor } = createEditor([graphicItemItem()]);

		editor.updateItem('missing', { label: 'x' });
		editor.updateGroup('w1', { label: 'x' });
		editor.convertGroupArrangement('w1', 'canvas');

		expect(updateConfig).not.toHaveBeenCalled();
	});

	it('patchFrame routes frame edits through the writer', () => {
		const { config, updateConfig, editor } = createEditor([]);

		editor.patchFrame({ backgroundColor: '#123456' });

		expect(updateConfig).toHaveBeenCalledOnce();
		expect(config.value.layout.frame.backgroundColor).toBe('#123456');
	});

	it('parses percentage geometry input against the screen dimensions', () => {
		const { config, editor } = createEditor([graphicItemItem()]);

		editor.updateItemRectFromAnchor('w1', 'width', '50', '%');

		expect(config.value.layout.items[0]!.width).toBe(960);
	});

	it('createLayoutItem submits and returns the new id', () => {
		const { config, editor } = createEditor([]);

		const id = editor.createLayoutItem('source');

		expect(config.value.layout.items[0]!.id).toBe(id);
		expect(config.value.layout.items[0]!.type).toBe('source');
	});
});
