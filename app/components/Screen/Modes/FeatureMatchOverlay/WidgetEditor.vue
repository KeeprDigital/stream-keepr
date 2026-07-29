<script setup lang="ts">
import type {
	FeatureMatchGameWinsBoxOrientation,
	FeatureMatchGameWinsDisplayMode,
	FeatureMatchGraphicItemDefinitionConfig,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchOverlayTokenStyleMap,
} from '~~/shared/types/screenConfig';
import { FEATURE_MATCH_OVERLAY_TEMPLATE_TOKENS } from '~/utils/featureMatchOverlayTemplateValues';
import { DEFAULT_FEATURE_MATCH_OVERLAY_SPACER_WIDTH } from '~/utils/featureMatchOverlayTokens';
import FeatureMatchOverlayBoxStyleFields from './BoxStyleFields.vue';

const props = defineProps<{
	graphicItem: FeatureMatchGraphicItemDefinitionConfig;
	graphicItemSurfaceStyle?: FeatureMatchOverlayBoxStyle;
	eventId: number;
}>();

const emit = defineEmits<{
	update: [updates: FeatureMatchGraphicItemDefinitionConfig];
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

function patch(updates: Partial<FeatureMatchGraphicItemDefinitionConfig>) {
	emit('update', { ...props.graphicItem, ...updates } as FeatureMatchGraphicItemDefinitionConfig);
}

function appendToken(token: string) {
	if (props.graphicItem.type !== 'text')
		return;

	const current = props.graphicItem.template ?? '';
	const separator = current && !current.endsWith(' ') && !current.endsWith('\n') && !current.endsWith('{spacer}') ? ' ' : '';
	patch({ template: `${current}${separator}${tokenLabel(token)}` } as Partial<FeatureMatchGraphicItemDefinitionConfig>);
}

function appendSpacer() {
	if (props.graphicItem.type !== 'text')
		return;

	patch({ template: `${props.graphicItem.template ?? ''}{spacer}` } as Partial<FeatureMatchGraphicItemDefinitionConfig>);
}

function updateTokenStyle(token: string, updates: Partial<FeatureMatchOverlayBoxStyle>) {
	if (props.graphicItem.type !== 'text')
		return;

	const tokenStyles: FeatureMatchOverlayTokenStyleMap = {
		...(props.graphicItem.tokenStyles ?? {}),
		[token]: {
			...(props.graphicItem.tokenStyles?.[token] ?? {}),
			...updates,
		},
	};

	patch({ tokenStyles } as Partial<FeatureMatchGraphicItemDefinitionConfig>);
}
</script>

<template>
	<div class="space-y-4">
		<template v-if="graphicItem.type === 'text'">
			<UFormField label="Template">
				<UTextarea
					:model-value="graphicItem.template"
					autoresize
					class="w-full"
					@update:model-value="patch({ template: String($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
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
						:model-value="graphicItem.playerSide ?? 'player1'"
						:items="PLAYER_OPTIONS"
						value-key="value"
						size="sm"
						class="w-full"
						@update:model-value="patch({ playerSide: $event as any } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
					/>
				</UFormField>
				<UFormField label="Spacer width">
					<UInputNumber
						:model-value="graphicItem.spacerWidth ?? DEFAULT_FEATURE_MATCH_OVERLAY_SPACER_WIDTH"
						:min="0"
						:max="1000"
						size="sm"
						class="w-full"
						@update:model-value="patch({ spacerWidth: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
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
				:box-style="graphicItem.tokenStyles?.[selectedToken]"
				:include-background="false"
				:include-radius="false"
				@update="updates => updateTokenStyle(selectedToken, updates)"
			/>
		</template>

		<div v-else-if="graphicItem.type === 'image'" class="grid gap-3 md:grid-cols-2">
			<UFormField label="Image" class="md:col-span-2">
				<GraphicsAssetFocusPicker
					:model-value="graphicItem.asset"
					:event-id="eventId"
					field-label="Image Graphic Item"
					asset-kind="image"
					@update:model-value="patch({ asset: $event } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField label="Fit">
				<USelect
					:model-value="graphicItem.fit"
					:items="IMAGE_FIT_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ fit: $event as any } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField label="Opacity">
				<UInputNumber
					:model-value="graphicItem.opacity"
					:min="0"
					:max="1"
					:step="0.05"
					size="sm"
					class="w-full"
					@update:model-value="patch({ opacity: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField label="Radius">
				<UInputNumber
					:model-value="graphicItem.borderRadius"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="patch({ borderRadius: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
		</div>

		<p v-else-if="graphicItem.type === 'clock'" class="text-sm text-muted">
			Clock content comes from the live Feature Match Session. Use the style controls below for typography and framing.
		</p>

		<div v-else-if="graphicItem.type === 'player-life'" class="grid gap-3 md:grid-cols-2">
			<UFormField label="Player side">
				<USelect
					:model-value="graphicItem.playerSide"
					:items="PLAYER_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ playerSide: $event as any } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField label="Animation">
				<USelect
					:model-value="graphicItem.lifeAnimation ?? 'glow'"
					:items="LIFE_ANIMATION_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ lifeAnimation: $event as any } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField label="Duration">
				<UInputNumber
					:model-value="graphicItem.lifeAnimationDurationMs ?? 420"
					:min="100"
					:max="3000"
					size="sm"
					class="w-full"
					@update:model-value="patch({ lifeAnimationDurationMs: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField label="Accent Color">
				<UIColorPicker
					:model-value="graphicItem.lifeAnimationAccentColor"
					placeholder="#ffffff"
					@update:model-value="patch({ lifeAnimationAccentColor: $event || undefined } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
		</div>

		<div v-else-if="graphicItem.type === 'game-wins'" class="grid gap-3 md:grid-cols-3">
			<UFormField label="Player side">
				<USelect
					:model-value="graphicItem.playerSide"
					:items="PLAYER_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ playerSide: $event as any } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField label="Display">
				<USelect
					:model-value="graphicItem.displayMode ?? 'boxes'"
					:items="GAME_WINS_DISPLAY_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ displayMode: $event as FeatureMatchGameWinsDisplayMode } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(graphicItem.displayMode ?? 'boxes') === 'boxes'" label="Box arrangement">
				<USelect
					:model-value="graphicItem.boxOrientation ?? 'horizontal'"
					:items="GAME_WINS_BOX_ORIENTATION_OPTIONS"
					value-key="value"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxOrientation: $event as FeatureMatchGameWinsBoxOrientation } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(graphicItem.displayMode ?? 'boxes') === 'boxes'" label="Box width">
				<UInputNumber
					:model-value="graphicItem.boxWidth ?? 22"
					:min="1"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxWidth: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(graphicItem.displayMode ?? 'boxes') === 'boxes'" label="Box height">
				<UInputNumber
					:model-value="graphicItem.boxHeight ?? 22"
					:min="1"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxHeight: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(graphicItem.displayMode ?? 'boxes') === 'boxes'" label="Box gap">
				<UInputNumber
					:model-value="graphicItem.boxGap ?? graphicItemSurfaceStyle?.padding ?? 6"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxGap: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
			<UFormField v-if="(graphicItem.displayMode ?? 'boxes') === 'boxes'" label="Box border width">
				<UInputNumber
					:model-value="graphicItem.boxBorderWidth ?? graphicItemSurfaceStyle?.borderWidth ?? 2"
					:min="0"
					size="sm"
					class="w-full"
					@update:model-value="patch({ boxBorderWidth: Number($event) } as Partial<FeatureMatchGraphicItemDefinitionConfig>)"
				/>
			</UFormField>
		</div>
	</div>
</template>
