<script setup lang="ts">
import type { GraphicSurfaceStyleEdit } from '~~/shared/modules/graphics';
import type { ThemeSurfaceStyle } from '~~/shared/modules/theme';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';

// A Graphic Surface Style token: a fill, its opacity, an outline and a glow, in
// the surface editor the graphics inspector shares. Every colour is a literal.

/** The surface as it resolves: every colour a literal. */
type Surface = ThemeSurfaceStyle<string>;

const props = defineProps<{
	modelValue: Surface;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: Surface];
}>();

// What a colour starts as where the surface holds none yet: the shipped colour of the role it had.
const DEFAULT_COLOR = FOUNDATION_TOKENS['text-primary'].default;
const DEFAULT_GLOW_COLOR = FOUNDATION_TOKENS.accent.default;

function commit(patch: Partial<Surface>) {
	const next: Surface = {
		...props.modelValue,
		...patch,
	};
	if (next.outline === undefined)
		delete next.outline;
	if (next.glow === undefined)
		delete next.glow;
	emit('commit', next);
}

/** A token always paints its surface, so the editor offers no presence switch to edit. */
function edit(change: GraphicSurfaceStyleEdit) {
	switch (change.kind) {
		case 'present':
			return;
		case 'fill-opacity':
			commit({ fillOpacity: change.fillOpacity });
			return;
		case 'outline':
			commit({
				outline: change.patch
					? {
							...(props.modelValue.outline ?? { color: DEFAULT_COLOR, width: 2 }),
							...withoutUndefined(change.patch),
						}
					: undefined,
			});
			return;
		case 'glow':
			commit({
				glow: change.patch
					? {
							...(props.modelValue.glow ?? { color: DEFAULT_GLOW_COLOR, size: 8, opacity: 0.5 }),
							...withoutUndefined(change.patch),
						}
					: undefined,
			});
			return;
		default:
			commit({
				fill: applyGraphicFillEdit(props.modelValue.fill, change, { gradientEndColor: DEFAULT_COLOR }),
			});
	}
}

/** A cleared colour leaves the one the token holds. */
function withoutUndefined<T extends object>(patch: T): Partial<T> {
	return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}
</script>

<template>
	<GraphicsCompositorSurfaceStyleFields
		:surface-style="modelValue"
		:title="label"
		flat
		size="xs"
		test-id-prefix="theme-surface"
		@edit="edit"
	>
		<template #color="{ target, value, label: colorLabel, testId, update }">
			<ThemeColorField
				:value="value ?? DEFAULT_COLOR"
				:label="colorLabel"
				:test-id="testId"
				:alpha="target === 'border'"
				@update="update"
			/>
		</template>
	</GraphicsCompositorSurfaceStyleFields>
</template>
