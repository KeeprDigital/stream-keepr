<script setup lang="ts">
import type { GraphicFillEdit } from '~~/shared/modules/graphics';
import type { ThemeSurfaceStyle } from '~~/shared/modules/theme';
import type { BorderGlowEdit } from '~/types/borderGlow';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';

// A Graphic Surface Style token: a fill, its opacity, an outline and a glow.
// Every colour is a literal.

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

function editFill(change: GraphicFillEdit) {
	commit({
		fill: applyGraphicFillEdit(props.modelValue.fill, change, { gradientEndColor: DEFAULT_COLOR }),
	});
}

function editBorderGlow(edit: BorderGlowEdit) {
	const { color, ...fields } = edit.patch ?? {};
	const colored = color === undefined
		? {}
		: { color };
	if (edit.kind === 'border') {
		commit({
			outline: edit.patch
				? {
						...(props.modelValue.outline ?? { color: DEFAULT_COLOR, width: 2 }),
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
					...(props.modelValue.glow ?? { color: DEFAULT_GLOW_COLOR, size: 8, opacity: 0.5 }),
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
			:fill="modelValue.fill"
			size="xs"
			:aria-label-prefix="label"
			test-id-prefix="theme-surface-fill"
			@edit="editFill"
		>
			<template #color="{ value, label: colorLabel, testId, update }">
				<ThemeColorField
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
			:border="modelValue.outline ?? null"
			:glow="modelValue.glow ?? null"
			size="xs"
			:aria-label-prefix="label"
			border-test-id="theme-surface-outline"
			glow-test-id="theme-surface-glow"
			@edit="editBorderGlow"
		>
			<template #color="{ target, value, label: colorLabel, update }">
				<ThemeColorField
					:value="value ?? DEFAULT_COLOR"
					:label="colorLabel"
					:alpha="target === 'border'"
					@update="update"
				/>
			</template>
		</GraphicsBorderGlowFields>
	</div>
</template>
