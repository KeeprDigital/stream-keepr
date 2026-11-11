<script setup lang="ts">
import type { ThemeTypography } from '~~/shared/modules/theme';
import type { GraphicFontSource, GraphicTypography } from '~~/shared/types/graphics';
import { DEFAULT_GRAPHIC_FONT_ID } from '~~/shared/modules/graphics/typography';

// A typography token: an application font or one exact library font revision
// (ADR-0050), and how it is set, in the typography editor the graphics inspector
// shares. It has no size; each consumer owns its own. Each field commits the
// whole token.

const props = defineProps<{
	modelValue: ThemeTypography;
	label: string;
	/** The Event whose adopted assets the font picker offers first, if any. */
	eventId?: number;
}>();

const emit = defineEmits<{
	commit: [value: ThemeTypography];
}>();

type Fields = Pick<GraphicTypography, 'fontWeight' | 'letterSpacing' | 'lineHeight' | 'textTransform'>;

/** The token as the typography editor names its fields. */
const fields = computed<Fields>(() => ({
	fontWeight: props.modelValue.weight,
	letterSpacing: props.modelValue.tracking,
	lineHeight: props.modelValue.lineHeight,
	textTransform: props.modelValue.case,
}));

function commit(patch: Partial<ThemeTypography>) {
	emit('commit', {
		...props.modelValue,
		...patch,
	});
}

function edit(patch: Partial<Fields>) {
	commit({
		...(patch.fontWeight === undefined
			? {}
			: { weight: patch.fontWeight }),
		...(patch.letterSpacing === undefined
			? {}
			: { tracking: patch.letterSpacing }),
		...(patch.lineHeight === undefined
			? {}
			: { lineHeight: patch.lineHeight }),
		...(patch.textTransform === undefined
			? {}
			: { case: patch.textTransform }),
	});
}

/**
 * The font arm shown, held here: choosing "Library font" pins nothing until a
 * revision is picked, and a typography token must always name a font.
 */
const fontSource = ref<GraphicFontSource>(props.modelValue.font.kind);
watch(() => props.modelValue.font.kind, (kind) => {
	fontSource.value = kind;
});

function chooseFontSource(source: GraphicFontSource) {
	fontSource.value = source;
	if (source === 'application' && props.modelValue.font.kind !== 'application') {
		commit({
			font: { kind: 'application', fontId: DEFAULT_GRAPHIC_FONT_ID },
		});
	}
}
</script>

<template>
	<div class="space-y-2">
		<GraphicsTypographyFields
			:typography="fields"
			variant="theme"
			size="xs"
			test-id-prefix="theme-typography"
			:aria-label-prefix="label"
			@update="edit"
		>
			<template #font>
				<div class="flex flex-col gap-2" data-token-part="font" :data-font-kind="modelValue.font.kind">
					<GraphicsCompositorFontSelectionField
						:source="fontSource"
						:font="modelValue.font"
						:event-id="eventId"
						:field-label="`${label} font`"
						size="sm"
						:test-id-prefix="`theme-${label}`"
						@update:source="chooseFontSource"
						@application="fontId => commit({ font: { kind: 'application', fontId } })"
						@select="(_asset, reference) => commit({ font: { kind: 'asset', reference } })"
						@clear="chooseFontSource('application')"
					/>
				</div>
			</template>
		</GraphicsTypographyFields>
	</div>
</template>
