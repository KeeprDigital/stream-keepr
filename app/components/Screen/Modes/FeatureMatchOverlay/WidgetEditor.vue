<script setup lang="ts">
import type {
	FeatureMatchGameWinsBoxOrientation,
	FeatureMatchGameWinsDisplayMode,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchOverlayTokenStyleMap,
	FeatureMatchWidgetConfig,
} from '~~/shared/types/screenConfig';
import { FEATURE_MATCH_OVERLAY_TEMPLATE_TOKENS } from '~/utils/featureMatchOverlayTemplateValues';
import { DEFAULT_FEATURE_MATCH_OVERLAY_SPACER_WIDTH } from '~/utils/featureMatchOverlayTokens';
import FeatureMatchOverlayBoxStyleFields from './BoxStyleFields.vue';

const props = defineProps<{
	widget: FeatureMatchWidgetConfig;
	widgetSurfaceStyle?: FeatureMatchOverlayBoxStyle;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [updates: FeatureMatchWidgetConfig];
}>();

const selectedToken = ref<(typeof FEATURE_MATCH_OVERLAY_TEMPLATE_TOKENS)[number]>('name');

const PLAYER_OPTIONS = [
	{ label: 'Player 1', value: 'player1' },
	{ label: 'Player 2', value: 'player2' },
];

const IMAGE_FIT_OPTIONS = [
	{ label: 'Contain', value: 'contain' },
	{ label: 'Cover', value: 'cover' },
	{ label: 'Fill', value: 'fill' },
];

const LIFE_ANIMATION_OPTIONS = [
	{ label: 'None', value: 'none' },
	{ label: 'Fade', value: 'fade' },
	{ label: 'Pop', value: 'pop' },
	{ label: 'Slide', value: 'slide' },
	{ label: 'Glow', value: 'glow' },
];

const GAME_WINS_DISPLAY_OPTIONS = [
	{ label: 'Boxes', value: 'boxes' },
	{ label: 'Number', value: 'number' },
] satisfies Array<{ label: string; value: FeatureMatchGameWinsDisplayMode }>;

const GAME_WINS_BOX_ORIENTATION_OPTIONS = [
	{ label: 'Horizontal', value: 'horizontal' },
	{ label: 'Vertical', value: 'vertical' },
] satisfies Array<{ label: string; value: FeatureMatchGameWinsBoxOrientation }>;

const TOKEN_OPTIONS = FEATURE_MATCH_OVERLAY_TEMPLATE_TOKENS.map(token => ({
	label: `{${token}}`,
	value: token,
}));

function tokenLabel(token: string) {
	return `{${token}}`;
}

function patch(updates: Partial<FeatureMatchWidgetConfig>) {
	emit('update', { ...props.widget, ...updates } as FeatureMatchWidgetConfig);
}

function appendToken(token: string) {
	if (props.widget.type !== 'text')
		return;

	const current = props.widget.template ?? '';
	const separator = current && !current.endsWith(' ') && !current.endsWith('\n') && !current.endsWith('{spacer}') ? ' ' : '';
	patch({ template: `${current}${separator}${tokenLabel(token)}` } as Partial<FeatureMatchWidgetConfig>);
}

function appendSpacer() {
	if (props.widget.type !== 'text')
		return;

	patch({ template: `${props.widget.template ?? ''}{spacer}` } as Partial<FeatureMatchWidgetConfig>);
}

function updateTokenStyle(token: string, updates: Partial<FeatureMatchOverlayBoxStyle>) {
	if (props.widget.type !== 'text')
		return;

	const tokenStyles: FeatureMatchOverlayTokenStyleMap = {
		...(props.widget.tokenStyles ?? {}),
		[token]: {
			...(props.widget.tokenStyles?.[token] ?? {}),
			...updates,
		},
	};

	patch({ tokenStyles } as Partial<FeatureMatchWidgetConfig>);
}
</script>

<template>
	<div class="space-y-4">
		<template v-if="widget.type === 'text'">
			<UFormField label="Template">
				<UTextarea
					:model-value="widget.template"
					autoresize
					class="w-full"
					@update:model-value="patch({ template: String($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
				<div class="mt-2 flex flex-wrap gap-1">
					<UButton
						size="xs"
						variant="soft"
						icon="i-lucide-arrow-left-right"
						@click="appendSpacer"
					>
						Spacer
					</UButton>
					<UButton
						v-for="token in FEATURE_MATCH_OVERLAY_TEMPLATE_TOKENS"
						:key="token"
						size="xs"
						variant="soft"
						@click="appendToken(token)"
					>
						{{ tokenLabel(token) }}
					</UButton>
				</div>
			</UFormField>

			<div class="grid gap-3 md:grid-cols-3">
				<UFormField label="Player side">
					<USelect
						:model-value="widget.playerSide ?? 'player1'"
						:items="PLAYER_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						@update:model-value="patch({ playerSide: $event as any } as Partial<FeatureMatchWidgetConfig>)"
					/>
				</UFormField>
				<UFormField label="Spacer width">
					<UInputNumber
						:model-value="widget.spacerWidth ?? DEFAULT_FEATURE_MATCH_OVERLAY_SPACER_WIDTH"
						:min="0"
						:max="1000"
						size="sm"
						class="w-full"
						@update:model-value="patch({ spacerWidth: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
					/>
				</UFormField>
				<UFormField label="Token style">
					<USelect
						v-model="selectedToken"
						:items="TOKEN_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
					/>
				</UFormField>
			</div>

			<FeatureMatchOverlayBoxStyleFields
				title="Selected Token Style"
				:box-style="widget.tokenStyles?.[selectedToken]"
				:include-background="false"
				:include-radius="false"
				@update="updates => updateTokenStyle(selectedToken, updates)"
			/>
		</template>

		<div v-else-if="widget.type === 'image'" class="grid gap-3 md:grid-cols-2">
			<UFormField label="Image" class="md:col-span-2">
				<GraphicsAssetFocusPicker
					:model-value="widget.asset"
					:event-id="eventId"
					field-label="Image Graphic Item"
					asset-kind="image"
					@update:model-value="patch({ asset: $event } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField label="Fit">
				<USelect
					:model-value="widget.fit"
					:items="IMAGE_FIT_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ fit: $event as any } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField label="Opacity">
				<UInputNumber
					:model-value="widget.opacity"
					:min="0"
					:max="1"
					:step="0.05"
					size="sm"
					class="w-full"
					@update:model-value="patch({ opacity: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField label="Radius">
				<UInputNumber
					:model-value="widget.borderRadius"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="patch({ borderRadius: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
		</div>

		<p v-else-if="widget.type === 'clock'" class="text-sm text-muted">
			Clock content comes from the live Feature Match Session. Use the style controls below for typography and framing.
		</p>

		<div v-else-if="widget.type === 'player-life'" class="grid gap-3 md:grid-cols-2">
			<UFormField label="Player side">
				<USelect
					:model-value="widget.playerSide"
					:items="PLAYER_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ playerSide: $event as any } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField label="Animation">
				<USelect
					:model-value="widget.lifeAnimation ?? 'glow'"
					:items="LIFE_ANIMATION_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ lifeAnimation: $event as any } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField label="Duration">
				<UInputNumber
					:model-value="widget.lifeAnimationDurationMs ?? 420"
					:min="100"
					:max="3000"
					size="sm"
					class="w-full"
					@update:model-value="patch({ lifeAnimationDurationMs: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField label="Accent Color">
				<UIColorPicker
					:model-value="widget.lifeAnimationAccentColor"
					placeholder="#ffffff"
					@update:model-value="patch({ lifeAnimationAccentColor: $event || undefined } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
		</div>

		<div v-else-if="widget.type === 'game-wins'" class="grid gap-3 md:grid-cols-3">
			<UFormField label="Player side">
				<USelect
					:model-value="widget.playerSide"
					:items="PLAYER_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ playerSide: $event as any } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField label="Display">
				<USelect
					:model-value="widget.displayMode ?? 'boxes'"
					:items="GAME_WINS_DISPLAY_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ displayMode: $event as FeatureMatchGameWinsDisplayMode } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(widget.displayMode ?? 'boxes') === 'boxes'" label="Box arrangement">
				<USelect
					:model-value="widget.boxOrientation ?? 'horizontal'"
					:items="GAME_WINS_BOX_ORIENTATION_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxOrientation: $event as FeatureMatchGameWinsBoxOrientation } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(widget.displayMode ?? 'boxes') === 'boxes'" label="Box width">
				<UInputNumber
					:model-value="widget.boxWidth ?? 22"
					:min="1"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxWidth: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(widget.displayMode ?? 'boxes') === 'boxes'" label="Box height">
				<UInputNumber
					:model-value="widget.boxHeight ?? 22"
					:min="1"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxHeight: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(widget.displayMode ?? 'boxes') === 'boxes'" label="Box gap">
				<UInputNumber
					:model-value="widget.boxGap ?? widgetSurfaceStyle?.padding ?? 6"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxGap: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(widget.displayMode ?? 'boxes') === 'boxes'" label="Box border width">
				<UInputNumber
					:model-value="widget.boxBorderWidth ?? widgetSurfaceStyle?.borderWidth ?? 2"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxBorderWidth: Number($event) } as Partial<FeatureMatchWidgetConfig>)"
				/>
			</UFormField>
		</div>
	</div>
</template>
