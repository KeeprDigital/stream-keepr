import type { ZodNumber, ZodType, ZodTypeAny } from 'zod';
import type { GraphicAssetReference } from './types/graphicsAsset';
import type { FeatureMatchGraphicItemDefinitionConfig } from './types/screenConfig';

export type FeatureMatchGraphicItemType = FeatureMatchGraphicItemDefinitionConfig['type'];

export interface GraphicItemAssetReferenceDiscovery {
	reference: GraphicAssetReference;
	ownerSuffix: string;
	kind: 'font';
}

export interface GraphicItemSchemaDependencies {
	playerSide: ZodTypeAny;
	optionalCssColor: ZodTypeAny;
	finiteNumber: ZodNumber;
	tokenStyleMap: ZodTypeAny;
	lifeAnimation: ZodTypeAny;
	gameWinsDisplayMode: ZodTypeAny;
	gameWinsBoxOrientation: ZodTypeAny;
	z: typeof import('zod').z;
}

export interface GraphicItemRendererContext<Result> {
	text: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'text' }>) => Result;
	clock: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'clock' }>) => Result;
	playerLife: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'player-life' }>) => Result;
	gameWins: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'game-wins' }>) => Result;
}

export interface FeatureMatchGraphicItemDefinition<
	Config extends FeatureMatchGraphicItemDefinitionConfig = FeatureMatchGraphicItemDefinitionConfig,
> {
	id: Config['type'];
	configurationVersion: 1;
	label: string;
	icon: string;
	editorControls: readonly string[];
	schema: (dependencies: GraphicItemSchemaDependencies) => ZodType<Config>;
	defaultConfig: () => Config;
	render: <Result>(config: Config, context: GraphicItemRendererContext<Result>) => Result;
	migrate: (config: Config, fromVersion: number) => Config;
	discoverAssetReferences: (config: Config) => GraphicItemAssetReferenceDiscovery[];
	summary: (config: Config) => string;
}

function currentVersion<Config extends FeatureMatchGraphicItemDefinitionConfig>(
	config: Config,
	fromVersion: number,
) {
	if (fromVersion !== 1)
		throw new Error(`Unsupported Graphic Item configuration version ${fromVersion}.`);
	return config;
}

const DEFINITIONS = {
	'text': {
		id: 'text',
		configurationVersion: 1,
		label: 'Text',
		icon: 'i-lucide-type',
		editorControls: ['template', 'player-side', 'spacer-width', 'token-typography'],
		schema: ({ z, playerSide, finiteNumber, tokenStyleMap }) => z.object({
			type: z.literal('text'),
			template: z.string().max(1000),
			playerSide: playerSide.optional(),
			spacerWidth: finiteNumber.nonnegative().max(1000).optional(),
			tokenStyles: tokenStyleMap.optional(),
		}).strict() as ZodType<Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'text' }>>,
		defaultConfig: () => ({ type: 'text', playerSide: 'player1', template: '{name}' }),
		render: (config, context) => context.text(config),
		migrate: currentVersion,
		discoverAssetReferences: config =>
			Object.entries(config.tokenStyles ?? {}).flatMap(([token, style]) =>
				style?.font?.kind === 'asset'
					? [{
							reference: style.font.reference,
							ownerSuffix: `tokenStyles.${token}.font`,
							kind: 'font' as const,
						}]
					: []),
		summary: config => config.template || 'Text',
	},
	'clock': {
		id: 'clock',
		configurationVersion: 1,
		label: 'Clock',
		icon: 'i-lucide-clock',
		editorControls: [],
		schema: ({ z }) => z.object({ type: z.literal('clock') }).strict(),
		defaultConfig: () => ({ type: 'clock' }),
		render: (config, context) => context.clock(config),
		migrate: currentVersion,
		discoverAssetReferences: () => [],
		summary: () => 'Live clock',
	},
	'player-life': {
		id: 'player-life',
		configurationVersion: 1,
		label: 'Life',
		icon: 'i-lucide-heart-pulse',
		editorControls: ['player-side', 'life-animation'],
		schema: ({ z, playerSide, lifeAnimation, finiteNumber, optionalCssColor }) => z.object({
			type: z.literal('player-life'),
			playerSide,
			lifeAnimation: lifeAnimation.optional(),
			lifeAnimationDurationMs: finiteNumber.int().min(100).max(3000).optional(),
			lifeAnimationAccentColor: optionalCssColor,
		}).strict() as ZodType<Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'player-life' }>>,
		defaultConfig: () => ({ type: 'player-life', playerSide: 'player1', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }),
		render: (config, context) => context.playerLife(config),
		migrate: currentVersion,
		discoverAssetReferences: () => [],
		summary: config => `${config.playerSide} life`,
	},
	'game-wins': {
		id: 'game-wins',
		configurationVersion: 1,
		label: 'Wins',
		icon: 'i-lucide-trophy',
		editorControls: ['player-side', 'display-mode', 'box-geometry'],
		schema: ({ z, playerSide, gameWinsDisplayMode, gameWinsBoxOrientation, finiteNumber }) => z.object({
			type: z.literal('game-wins'),
			playerSide,
			displayMode: gameWinsDisplayMode.optional(),
			boxOrientation: gameWinsBoxOrientation.optional(),
			boxWidth: finiteNumber.positive().max(10000).optional(),
			boxHeight: finiteNumber.positive().max(10000).optional(),
			boxGap: finiteNumber.nonnegative().max(10000).optional(),
			boxBorderWidth: finiteNumber.nonnegative().max(10000).optional(),
		}).strict() as ZodType<Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'game-wins' }>>,
		defaultConfig: () => ({ type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }),
		render: (config, context) => context.gameWins(config),
		migrate: currentVersion,
		discoverAssetReferences: () => [],
		summary: config => `${config.playerSide} wins`,
	},
} satisfies {
	[Type in FeatureMatchGraphicItemType]: FeatureMatchGraphicItemDefinition<
		Extract<FeatureMatchGraphicItemDefinitionConfig, { type: Type }>
	>;
};

export const FEATURE_MATCH_GRAPHIC_ITEM_TYPES = Object.keys(DEFINITIONS) as FeatureMatchGraphicItemType[];

export function featureMatchGraphicItemDefinition<Type extends FeatureMatchGraphicItemType>(
	type: Type,
): FeatureMatchGraphicItemDefinition<Extract<FeatureMatchGraphicItemDefinitionConfig, { type: Type }>> {
	return DEFINITIONS[type] as unknown as FeatureMatchGraphicItemDefinition<
		Extract<FeatureMatchGraphicItemDefinitionConfig, { type: Type }>
	>;
}

export function featureMatchGraphicItemSchemas(dependencies: GraphicItemSchemaDependencies) {
	return [
		DEFINITIONS.text.schema(dependencies),
		DEFINITIONS.clock.schema(dependencies),
		DEFINITIONS['player-life'].schema(dependencies),
		DEFINITIONS['game-wins'].schema(dependencies),
	] as const;
}

export function discoverFeatureMatchGraphicItemAssetReferences(
	config: FeatureMatchGraphicItemDefinitionConfig,
): GraphicItemAssetReferenceDiscovery[] {
	return featureMatchGraphicItemDefinition(config.type)
		.discoverAssetReferences(config as never);
}
