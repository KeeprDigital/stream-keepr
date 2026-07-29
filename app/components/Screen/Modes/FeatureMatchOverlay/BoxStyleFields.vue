<script setup lang="ts">
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchOverlayBoxStyle } from '~~/shared/types/screenConfig';
import { FEATURE_MATCH_OVERLAY_FONTS, getFeatureMatchOverlayFontDefinition, resolveFeatureMatchOverlayFontSelection } from '~~/shared/featureMatchOverlayFonts';
import FeatureMatchOverlayBackgroundFields from './BackgroundFields.vue';
import FeatureMatchOverlayBorderRadiusControl from './BorderRadiusControl.vue';
import FeatureMatchOverlayBorderSidesControl from './BorderSidesControl.vue';

const props = withDefaults(defineProps<{
	title?: string;
	boxStyle?: FeatureMatchOverlayBoxStyle;
	fallbackStyle?: FeatureMatchOverlayBoxStyle;
	includeText?: boolean;
	includeBackground?: boolean;
	includePadding?: boolean;
	includeRadius?: boolean;
	includeBorder?: boolean;
	includeOverflow?: boolean;
}>(), {
	includeText: true,
	includeBackground: true,
	includePadding: false,
	includeRadius: true,
	includeBorder: false,
	includeOverflow: false,
});

const emit = defineEmits<{
	update: [updates: Partial<FeatureMatchOverlayBoxStyle>];
}>();
const eventStore = useEventStore();

const OVERFLOW_OPTIONS = [
	{ label: 'Clip', value: 'clip' },
	{ label: 'Ellipsis', value: 'ellipsis' },
	{ label: 'Shrink', value: 'shrink' },
	{ label: 'Visible', value: 'visible' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayBoxStyle['overflow'] }>;

const FONT_STYLE_OPTIONS = [
	{ label: 'Normal', value: 'normal' },
	{ label: 'Italic', value: 'italic' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayBoxStyle['fontStyle'] }>;

const TEXT_TRANSFORM_OPTIONS = [
	{ label: 'None', value: 'none' },
	{ label: 'Uppercase', value: 'uppercase' },
	{ label: 'Lowercase', value: 'lowercase' },
	{ label: 'Capitalize', value: 'capitalize' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayBoxStyle['textTransform'] }>;

const DEFAULT_FONT_FAMILY_SELECT_VALUE = '__feature-match-overlay-default-font__';

const fontFamilyOptions = computed(() => {
	return [
		{ label: 'Default', value: DEFAULT_FONT_FAMILY_SELECT_VALUE },
		...FEATURE_MATCH_OVERLAY_FONTS.map(font => ({
			label: font.label,
			value: font.id,
		})),
	];
});

const fontFamilySelectValue = computed(() => {
	const selection = styleValue('font');
	if (selection?.kind === 'application')
		return selection.fontId;
	return DEFAULT_FONT_FAMILY_SELECT_VALUE;
});

const fontAssetReference = computed<GraphicAssetReference | undefined>({
	get: () => {
		const selection = styleValue('font');
		return selection?.kind === 'asset' ? selection.reference : undefined;
	},
	set: reference => emit('update', {
		font: reference ? { kind: 'asset', reference } : undefined,
	}),
});

const fontPreviewStyle = computed(() => ({
	fontFamily: resolveFeatureMatchOverlayFontSelection(styleValue('font')),
}));

function styleValue<K extends keyof FeatureMatchOverlayBoxStyle>(key: K, fallback?: FeatureMatchOverlayBoxStyle[K]) {
	return props.boxStyle?.[key] ?? props.fallbackStyle?.[key] ?? fallback;
}

function borderSideValue(key: 'borderTopVisible' | 'borderRightVisible' | 'borderBottomVisible' | 'borderLeftVisible') {
	return styleValue(key, true);
}

function updateBackground(updates: { color?: string; gradient?: string; opacity?: number }) {
	const styleUpdates: Partial<FeatureMatchOverlayBoxStyle> = {};
	if ('color' in updates)
		styleUpdates.backgroundColor = updates.color;
	if ('gradient' in updates)
		styleUpdates.backgroundGradient = updates.gradient;
	if ('opacity' in updates)
		styleUpdates.backgroundOpacity = updates.opacity;
	emit('update', styleUpdates);
}

function updateFontFamily(value: unknown) {
	if (value === DEFAULT_FONT_FAMILY_SELECT_VALUE) {
		emit('update', { font: undefined });
		return;
	}

	const fontId = String(value || '').trim();
	if (getFeatureMatchOverlayFontDefinition(fontId)) {
		emit('update', {
			font: { kind: 'application', fontId },
		});
	}
}
</script>

<template>
	<div class="space-y-4">
		<div v-if="title">
			<p class="font-medium">
				{{ title }}
			</p>
		</div>

		<div class="divide-y divide-default/60">
			<section v-if="includeText" class="py-4 first:pt-0 last:pb-0">
				<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&_[role=combobox]]:w-full">
					<UFormField label="Text Color">
						<UIColorPicker
							:model-value="styleValue('textColor')"
							placeholder="#ffffff"
							@update:model-value="emit('update', { textColor: $event || undefined })"
						/>
					</UFormField>
					<UFormField label="Font Size">
						<UInputNumber
							:model-value="styleValue('fontSize', 24)"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { fontSize: Number($event) })"
						/>
					</UFormField>
					<UFormField label="Font Face">
						<USelect
							:model-value="fontFamilySelectValue"
							:items="fontFamilyOptions"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="updateFontFamily"
						/>
						<p class="mt-1 truncate text-xs text-muted" :style="fontPreviewStyle">
							Aa 012 Player Name
						</p>
						<GraphicsAssetFocusPicker
							v-if="eventStore.eventId"
							v-model="fontAssetReference"
							class="mt-2"
							:event-id="eventStore.eventId"
							field-label="Choose exact font revision"
							asset-kind="font"
						/>
					</UFormField>
					<UFormField label="Font Weight">
						<UInput
							:model-value="styleValue('fontWeight', 600)"
							placeholder="400, 700, bold..."
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { fontWeight: String($event || '') || undefined })"
						/>
					</UFormField>
					<UFormField label="Font Style">
						<USelect
							:model-value="styleValue('fontStyle', 'normal')"
							:items="FONT_STYLE_OPTIONS"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { fontStyle: $event as FeatureMatchOverlayBoxStyle['fontStyle'] })"
						/>
					</UFormField>
					<UFormField label="Text Transform">
						<USelect
							:model-value="styleValue('textTransform', 'none')"
							:items="TEXT_TRANSFORM_OPTIONS"
							value-key="value"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { textTransform: $event as FeatureMatchOverlayBoxStyle['textTransform'] })"
						/>
					</UFormField>
					<UFormField label="Letter Spacing">
						<UInputNumber
							:model-value="styleValue('letterSpacing', 0)"
							:step="0.1"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { letterSpacing: Number($event) })"
						/>
					</UFormField>
					<UFormField label="Line Height">
						<UInputNumber
							:model-value="styleValue('lineHeight', undefined)"
							:step="0.05"
							placeholder="normal"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { lineHeight: String($event ?? '') === '' ? undefined : Number($event) })"
						/>
					</UFormField>
				</div>
			</section>

			<section v-if="includeBackground || includePadding || includeOverflow" class="py-4 first:pt-0 last:pb-0">
				<div class="space-y-3">
					<FeatureMatchOverlayBackgroundFields
						v-if="includeBackground"
						:color="styleValue('backgroundColor')"
						:gradient="styleValue('backgroundGradient')"
						:opacity="styleValue('backgroundOpacity', 0)"
						empty-color-value="transparent"
						@update="updateBackground"
					/>
					<div
						v-if="includePadding || includeOverflow"
						class="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
					>
						<UFormField v-if="includePadding" label="Padding">
							<UInputNumber
								:model-value="styleValue('padding', 0)"
								size="sm"
								class="w-full"
								@update:model-value="emit('update', { padding: Number($event) })"
							/>
						</UFormField>
						<UFormField v-if="includeOverflow" label="Content Overflow">
							<USelect
								:model-value="styleValue('overflow', 'ellipsis')"
								:items="OVERFLOW_OPTIONS"
								value-key="value"
								size="sm"
								class="w-full"
								@update:model-value="emit('update', { overflow: $event as FeatureMatchOverlayBoxStyle['overflow'] })"
							/>
						</UFormField>
					</div>
				</div>
			</section>

			<section v-if="includeRadius" class="py-4 first:pt-0 last:pb-0">
				<FeatureMatchOverlayBorderRadiusControl
					:border-radius="styleValue('borderRadius', 0)"
					:border-radius-top-left="styleValue('borderRadiusTopLeft', styleValue('borderRadius', 0))"
					:border-radius-top-right="styleValue('borderRadiusTopRight', styleValue('borderRadius', 0))"
					:border-radius-bottom-right="styleValue('borderRadiusBottomRight', styleValue('borderRadius', 0))"
					:border-radius-bottom-left="styleValue('borderRadiusBottomLeft', styleValue('borderRadius', 0))"
					@update="(field, value) => emit('update', { [field]: value })"
				/>
			</section>

			<section v-if="includeBorder" class="space-y-3 py-4 first:pt-0 last:pb-0">
				<ScreenSettingsToggle
					label="GraphicItem border"
					:model-value="styleValue('borderVisible', false)"
					@update:model-value="emit('update', { borderVisible: $event })"
				/>
				<div v-if="styleValue('borderVisible', false)" class="grid items-end gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)]">
					<UFormField label="Color">
						<UIColorPicker
							:model-value="styleValue('borderColor')"
							placeholder="#ffffff"
							@update:model-value="emit('update', { borderColor: $event || undefined })"
						/>
					</UFormField>
					<FeatureMatchOverlayBorderSidesControl
						:border-top-visible="borderSideValue('borderTopVisible')"
						:border-right-visible="borderSideValue('borderRightVisible')"
						:border-bottom-visible="borderSideValue('borderBottomVisible')"
						:border-left-visible="borderSideValue('borderLeftVisible')"
						@update="(side, value) => emit('update', { [side]: value })"
					/>
					<UFormField label="Width">
						<UInputNumber
							:model-value="styleValue('borderWidth', 1)"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { borderWidth: Number($event) })"
						/>
					</UFormField>
				</div>
				<div v-if="styleValue('borderVisible', false)" class="grid gap-3 md:grid-cols-3">
					<UFormField label="Glow Color">
						<UIColorPicker
							:model-value="styleValue('glowColor')"
							placeholder="#ffffff"
							@update:model-value="emit('update', { glowColor: $event || undefined })"
						/>
					</UFormField>
					<UFormField label="Glow Size">
						<UInputNumber
							:model-value="styleValue('glowSize', 0)"
							:min="0"
							:max="200"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { glowSize: Number($event) })"
						/>
					</UFormField>
					<UFormField label="Glow Opacity">
						<UInputNumber
							:model-value="styleValue('glowOpacity', 0.75)"
							:step="0.05"
							:min="0"
							:max="1"
							size="sm"
							class="w-full"
							@update:model-value="emit('update', { glowOpacity: Number($event) })"
						/>
					</UFormField>
				</div>
			</section>
		</div>
	</div>
</template>
