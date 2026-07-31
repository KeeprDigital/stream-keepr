import type { FeatureMatchOverlayModeConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useFeatureMatchOverlayConfigEditor } from '~~/app/composables/screen/useFeatureMatchOverlayConfigEditor';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

// Layout mutation semantics live in the pure writer and are covered by
// test/unit/app/modules/featureMatchOverlayLayout.test.ts. This suite only
// checks the binding: id-addressed verbs submit the whole updated layout
// through updateConfig, no-ops submit nothing, and geometry input parsing
// uses the screen dimensions.

function sourceItem(overrides: Partial<FeatureMatchSourceItemConfig> = {}): FeatureMatchSourceItemConfig {
	return {
		id: 's1',
		label: 'Source',
		visible: true,
		x: 100,
		y: 50,
		width: 100,
		height: 40,
		sourceRole: 'main',
		frameCutout: true,
		...overrides,
	};
}

function createEditor(sources: FeatureMatchSourceItemConfig[]) {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	const config = ref<FeatureMatchOverlayModeConfig>({ ...base, layout: { ...base.layout, sources } });
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
	it('submits the whole updated layout for an id-addressed Source Item patch', () => {
		const { config, updateConfig, editor } = createEditor([sourceItem()]);

		editor.updateSource('s1', { label: 'Renamed' });

		expect(updateConfig).toHaveBeenCalledOnce();
		expect(updateConfig.mock.calls[0]![0]).toEqual({ layout: config.value.layout });
		expect(config.value.layout.sources[0]!.label).toBe('Renamed');
	});

	it('submits nothing when the mutation cannot apply', () => {
		const { updateConfig, editor } = createEditor([sourceItem()]);

		editor.updateSource('missing', { label: 'x' });
		editor.updateSourceSurfaceStyle('missing', { borderWidth: 2 });
		editor.removeSource('missing');

		expect(updateConfig).not.toHaveBeenCalled();
	});

	it('patchFrame routes frame edits through the writer', () => {
		const { config, updateConfig, editor } = createEditor([]);

		editor.patchFrame({ backgroundColor: '#123456' });

		expect(updateConfig).toHaveBeenCalledOnce();
		expect(config.value.layout.frame.backgroundColor).toBe('#123456');
	});

	it('parses percentage geometry input against the screen dimensions', () => {
		const { config, editor } = createEditor([sourceItem()]);

		editor.updateSourceRectFromAnchor('s1', 'width', '50', '%');

		expect(config.value.layout.sources[0]!.width).toBe(960);
	});

	it('createSourceItem submits and returns the new id', () => {
		const { config, editor } = createEditor([]);

		const id = editor.createSourceItem();

		expect(config.value.layout.sources[0]!.id).toBe(id);
		expect(config.value.layout.sources[0]!.frameCutout).toBe(true);
	});
});
