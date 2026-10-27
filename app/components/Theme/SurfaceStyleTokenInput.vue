<script setup lang="ts">
import type { GraphicFillEdit } from '~~/shared/modules/graphics';
import type { ThemeSurfaceStyle } from '~~/shared/modules/theme';
import type { GraphicFill } from '~~/shared/types/graphics';
import type { BorderGlowEdit } from '~/types/borderGlow';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';
import { decodeThemeColor, decodeThemeFill, encodeThemeColor, encodeThemeFill } from '~/modules/theme-editor/themeColor';

// A Graphic Surface Style token: a fill, its opacity, an outline and a glow.
// Every colour follows a colour token or holds its own.

const props = defineProps<{
	modelValue: ThemeSurfaceStyle;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: ThemeSurfaceStyle];
}>();

const DEFAULT_COLOR = encodeThemeColor({ token: 'text-primary' });

const encodedFill = computed(() => encodeThemeFill(props.modelValue.fill) as GraphicFill);

function commit(patch: Partial<ThemeSurfaceStyle>) {
	const next: ThemeSurfaceStyle = {
		...props.modelValue,
		...patch,
	};
	if (next.outline === undefined)
		delete next.outline;
	if (next.glow === undefined)
		delete next.glow;
	emit('commit', next);
}

function editFill(change: GraphicFillEdit) {
	commit({
		fill: decodeThemeFill(applyGraphicFillEdit(encodedFill.value, change, { gradientEndColor: DEFAULT_COLOR })),
	});
}

function editBorderGlow(edit: BorderGlowEdit) {
	if (edit.kind === 'border-side')
		return;
	const { color, ...fields } = edit.patch ?? {};
	const colored = color === undefined
		? {}
		: {
				color: decodeThemeColor(color),
			};
	if (edit.kind === 'border') {
		commit({
			outline: edit.patch
				? {
						...(props.modelValue.outline ?? {
							color: { token: 'text-primary' },
							width: 2,
						}),
						...fields,
						...colored,
					}
				: undefined,
		});
		return;
	}
	commit({
		glow: edit.patch
			? {
					...(props.modelValue.glow ?? {
						color: { token: 'accent' },
						size: 8,
						opacity: 0.5,
					}),
					...fields,
					...colored,
				}
			: undefined,
	});
}
</script>

<template>
	<div class="space-y-2">
		<GraphicsFillFields
			:fill="encodedFill"
			size="xs"
			:aria-label-prefix="label"
			test-id-prefix="theme-surface-fill"
			@edit="editFill"
		>
			<template #color="{ value, label: colorLabel, testId, update }">
				<ThemeColorSourceField
					:value="value"
					:label="colorLabel"
					:test-id="testId"
					@update="update"
				/>
			</template>
		</GraphicsFillFields>
		<UFormField label="Fill opacity" size="xs">
			<UIOpacityInput
				:model-value="modelValue.fillOpacity"
				size="xs"
				:aria-label="`${label} fill opacity`"
				@update:model-value="value => commit({ fillOpacity: value ?? 1 })"
			/>
		</UFormField>
		<GraphicsBorderGlowFields
			border-label="Outline"
			:border="modelValue.outline ? { color: encodeThemeColor(modelValue.outline.color), width: modelValue.outline.width } : null"
			:glow="modelValue.glow ? { color: encodeThemeColor(modelValue.glow.color), size: modelValue.glow.size, opacity: modelValue.glow.opacity } : null"
			size="xs"
			:aria-label-prefix="label"
			border-test-id="theme-surface-outline"
			glow-test-id="theme-surface-glow"
			@edit="editBorderGlow"
		>
			<template #color="{ value, label: colorLabel, update }">
				<ThemeColorSourceField :value="value ?? DEFAULT_COLOR" :label="colorLabel" @update="update" />
			</template>
		</GraphicsBorderGlowFields>
	</div>
</template>
