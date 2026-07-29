import type { ZodNumber, ZodType, ZodTypeAny } from 'zod';
import type { GraphicAssetReference } from './types/graphicsAsset';
import type {
	FeatureMatchGraphicGroupChildConfig,
	FeatureMatchGraphicGroupContentConfig,
	FeatureMatchGraphicItemDefinitionConfig,
	FeatureMatchGraphicItemDefinitionOwnedConfig,
	FeatureMatchLayoutItemConfig,
	FeatureMatchMediaGraphicItemContentConfig,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchSourceItemContentConfig,
} from './types/screenConfig';

export type FeatureMatchGraphicItemType = FeatureMatchGraphicItemDefinitionOwnedConfig['type'];

export interface GraphicItemAssetReferenceDiscovery {
	reference: GraphicAssetReference;
	ownerSuffix: string;
	kind: 'image' | 'silent-video' | 'font';
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
	videoTarget?: 'chromium' | 'safari';
}

export interface GraphicItemSchemaDependencies {
	playerSide: ZodTypeAny;
	optionalCssColor: ZodTypeAny;
	finiteNumber: ZodNumber;
	tokenStyleMap: ZodTypeAny;
	lifeAnimation: ZodTypeAny;
	gameWinsDisplayMode: ZodTypeAny;
	gameWinsBoxOrientation: ZodTypeAny;
	source: () => ZodTypeAny;
	media: () => ZodTypeAny;
	graphicGroup: () => ZodTypeAny;
	z: typeof import('zod').z;
}

export interface GraphicItemRendererContext<Result> {
	text: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'text' }>) => Result;
	clock: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'clock' }>) => Result;
	playerLife: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'player-life' }>) => Result;
	gameWins: (config: Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'game-wins' }>) => Result;
	media: (config: FeatureMatchMediaGraphicItemContentConfig) => Result;
	graphicGroup: (config: FeatureMatchGraphicGroupContentConfig) => Result;
	source: (config: FeatureMatchSourceItemContentConfig) => Result;
}

export interface FeatureMatchGraphicItemDefinition<
	Config extends FeatureMatchGraphicItemDefinitionOwnedConfig = FeatureMatchGraphicItemDefinitionOwnedConfig,
> {
	id: Config['type'];
	configurationVersion: 1;
	placement: 'top-level-only' | 'top-level-or-group';
	layoutKind: 'source' | 'media' | 'graphic-item' | 'group';
	label: string;
	icon: string;
	editorControls: readonly string[];
	schema: (dependencies: GraphicItemSchemaDependencies) => ZodType<Config>;
	defaultConfig: () => Config;
	render: <Result>(config: Config, context: GraphicItemRendererContext<Result>) => Result;
	migrate: (config: Config, fromVersion: number | undefined) => Config;
	discoverAssetReferences: (config: Config) => GraphicItemAssetReferenceDiscovery[];
	summary: (config: Config) => string;
}

function currentVersion<Config extends FeatureMatchGraphicItemDefinitionOwnedConfig>(
	config: Config,
	fromVersion: number | undefined,
) {
	if (fromVersion !== undefined && fromVersion !== 1)
		throw new Error(`Unsupported Graphic Item configuration version ${fromVersion}.`);
	return fromVersion === 1 && config.configurationVersion === 1
		? config
		: { ...config, configurationVersion: 1 };
}

function fontReference(
	style: FeatureMatchOverlayBoxStyle | undefined,
	ownerSuffix: string,
): GraphicItemAssetReferenceDiscovery[] {
	return style?.font?.kind === 'asset'
		? [{ reference: style.font.reference, ownerSuffix, kind: 'font' }]
		: [];
}

function discoverGraphicGroupAssetReferences(
	config: FeatureMatchGraphicGroupContentConfig,
): GraphicItemAssetReferenceDiscovery[] {
	return [
		...fontReference(config.surfaceStyle, 'surfaceStyle.font'),
		...fontReference(config.defaultChildSurfaceStyle, 'defaultChildSurfaceStyle.font'),
		...config.children.flatMap((child) => {
			const prefix = `children.${child.id}`;
			if (child.type === 'media') {
				return featureMatchGraphicItemDefinition('media')
					.discoverAssetReferences(child)
					.map((reference): GraphicItemAssetReferenceDiscovery => ({
						...reference,
						ownerSuffix: `${prefix}.${reference.ownerSuffix}`,
					}));
			}
			return [
				...fontReference(child.surfaceStyle, `${prefix}.surfaceStyle.font`),
				...featureMatchGraphicItemDefinition(child.graphicItem.type)
					.discoverAssetReferences(child.graphicItem as never)
					.map((reference): GraphicItemAssetReferenceDiscovery => ({
						...reference,
						ownerSuffix: `${prefix}.graphicItem.${reference.ownerSuffix}`,
					})),
			];
		}),
	];
}

const DEFINITIONS = {
	'source': {
		id: 'source',
		configurationVersion: 1,
		placement: 'top-level-only',
		layoutKind: 'source',
		label: 'Source',
		icon: 'i-lucide-video',
		editorControls: ['source-role', 'frame-cutout', 'surface-style'],
		schema: dependencies =>
			dependencies.source() as ZodType<FeatureMatchSourceItemContentConfig>,
		defaultConfig: () => ({
			type: 'source',
			configurationVersion: 1,
			sourceRole: 'main',
			frameCutout: true,
			surfaceStyle: {
				backgroundColor: '#000000',
				backgroundOpacity: 0,
				borderVisible: true,
				borderColor: '#0077a3',
				borderWidth: 4,
				borderRadius: 8,
			},
		}),
		render: (config, context) => context.source(config),
		migrate: currentVersion,
		discoverAssetReferences: config => fontReference(config.surfaceStyle, 'surfaceStyle.font'),
		summary: config => `${config.sourceRole || 'source'} source`,
	},
	'text': {
		id: 'text',
		configurationVersion: 1,
		placement: 'top-level-or-group',
		layoutKind: 'graphic-item',
		label: 'Text',
		icon: 'i-lucide-type',
		editorControls: ['template', 'player-side', 'spacer-width', 'token-typography'],
		schema: ({ z, playerSide, finiteNumber, tokenStyleMap }) => z.object({
			type: z.literal('text'),
			configurationVersion: z.literal(1),
			template: z.string().max(1000),
			playerSide: playerSide.optional(),
			spacerWidth: finiteNumber.nonnegative().max(1000).optional(),
			tokenStyles: tokenStyleMap.optional(),
		}).strict() as ZodType<Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'text' }>>,
		defaultConfig: () => ({ type: 'text', configurationVersion: 1, playerSide: 'player1', template: '{name}' }),
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
		placement: 'top-level-or-group',
		layoutKind: 'graphic-item',
		label: 'Clock',
		icon: 'i-lucide-clock',
		editorControls: [],
		schema: ({ z }) => z.object({
			type: z.literal('clock'),
			configurationVersion: z.literal(1),
		}).strict(),
		defaultConfig: () => ({ type: 'clock', configurationVersion: 1 }),
		render: (config, context) => context.clock(config),
		migrate: currentVersion,
		discoverAssetReferences: () => [],
		summary: () => 'Live clock',
	},
	'player-life': {
		id: 'player-life',
		configurationVersion: 1,
		placement: 'top-level-or-group',
		layoutKind: 'graphic-item',
		label: 'Life',
		icon: 'i-lucide-heart-pulse',
		editorControls: ['player-side', 'life-animation'],
		schema: ({ z, playerSide, lifeAnimation, finiteNumber, optionalCssColor }) => z.object({
			type: z.literal('player-life'),
			configurationVersion: z.literal(1),
			playerSide,
			lifeAnimation: lifeAnimation.optional(),
			lifeAnimationDurationMs: finiteNumber.int().min(100).max(3000).optional(),
			lifeAnimationAccentColor: optionalCssColor,
		}).strict() as ZodType<Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'player-life' }>>,
		defaultConfig: () => ({ type: 'player-life', configurationVersion: 1, playerSide: 'player1', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }),
		render: (config, context) => context.playerLife(config),
		migrate: currentVersion,
		discoverAssetReferences: () => [],
		summary: config => `${config.playerSide} life`,
	},
	'game-wins': {
		id: 'game-wins',
		configurationVersion: 1,
		placement: 'top-level-or-group',
		layoutKind: 'graphic-item',
		label: 'Wins',
		icon: 'i-lucide-trophy',
		editorControls: ['player-side', 'display-mode', 'box-geometry'],
		schema: ({ z, playerSide, gameWinsDisplayMode, gameWinsBoxOrientation, finiteNumber }) => z.object({
			type: z.literal('game-wins'),
			configurationVersion: z.literal(1),
			playerSide,
			displayMode: gameWinsDisplayMode.optional(),
			boxOrientation: gameWinsBoxOrientation.optional(),
			boxWidth: finiteNumber.positive().max(10000).optional(),
			boxHeight: finiteNumber.positive().max(10000).optional(),
			boxGap: finiteNumber.nonnegative().max(10000).optional(),
			boxBorderWidth: finiteNumber.nonnegative().max(10000).optional(),
		}).strict() as ZodType<Extract<FeatureMatchGraphicItemDefinitionConfig, { type: 'game-wins' }>>,
		defaultConfig: () => ({ type: 'game-wins', configurationVersion: 1, playerSide: 'player1', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }),
		render: (config, context) => context.gameWins(config),
		migrate: currentVersion,
		discoverAssetReferences: () => [],
		summary: config => `${config.playerSide} wins`,
	},
	'media': {
		id: 'media',
		configurationVersion: 1,
		placement: 'top-level-or-group',
		layoutKind: 'media',
		label: 'Media',
		icon: 'i-lucide-image-play',
		editorControls: ['asset', 'media-kind', 'fit', 'focal-position', 'opacity', 'clip-geometry', 'video-playback'],
		schema: dependencies =>
			dependencies.media() as ZodType<FeatureMatchMediaGraphicItemContentConfig>,
		defaultConfig: () => ({
			type: 'media',
			configurationVersion: 1,
			mediaKind: 'image',
			fit: 'contain',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			videoTarget: 'safari',
		}),
		render: (config, context) => context.media(config),
		migrate: currentVersion,
		discoverAssetReferences: config => config.asset
			? [{
					reference: config.asset,
					ownerSuffix: 'asset',
					kind: config.mediaKind,
					videoCompatibility: config.videoCompatibility,
					videoTarget: config.videoTarget,
				}]
			: [],
		summary: config => config.asset ? config.mediaKind : 'choose an asset',
	},
	'graphic-group': {
		id: 'graphic-group',
		configurationVersion: 1,
		placement: 'top-level-only',
		layoutKind: 'group',
		label: 'Group',
		icon: 'i-lucide-group',
		editorControls: ['arrangement', 'overflow', 'surface-style', 'child-defaults', 'children'],
		schema: dependencies =>
			dependencies.graphicGroup() as ZodType<FeatureMatchGraphicGroupContentConfig>,
		defaultConfig: () => ({
			type: 'graphic-group',
			configurationVersion: 1,
			surfaceStyle: { backgroundOpacity: 0 },
			defaultChildSurfaceStyle: {},
			arrangement: { mode: 'canvas', padding: 0 },
			overflow: 'clip',
			children: [],
		}),
		render: (config, context) => context.graphicGroup(config),
		migrate: currentVersion,
		discoverAssetReferences: discoverGraphicGroupAssetReferences,
		summary: config => `${config.children.length} Graphic Items`,
	},
} satisfies {
	[Type in FeatureMatchGraphicItemType]: FeatureMatchGraphicItemDefinition<
		Extract<FeatureMatchGraphicItemDefinitionOwnedConfig, { type: Type }>
	>;
};

export const FEATURE_MATCH_GRAPHIC_ITEM_TYPES = Object.keys(DEFINITIONS) as FeatureMatchGraphicItemType[];

export function featureMatchGraphicItemDefinition<Type extends FeatureMatchGraphicItemType>(
	type: Type,
): FeatureMatchGraphicItemDefinition<Extract<FeatureMatchGraphicItemDefinitionOwnedConfig, { type: Type }>> {
	return DEFINITIONS[type] as unknown as FeatureMatchGraphicItemDefinition<
		Extract<FeatureMatchGraphicItemDefinitionOwnedConfig, { type: Type }>
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

export function migrateFeatureMatchGraphicItemConfig<
	Config extends FeatureMatchGraphicItemDefinitionOwnedConfig,
>(config: Config): Config {
	return featureMatchGraphicItemDefinition(config.type)
		.migrate(config as never, config.configurationVersion) as Config;
}

export function featureMatchLayoutItemGraphicItemConfig(
	item: FeatureMatchLayoutItemConfig,
): FeatureMatchGraphicItemDefinitionOwnedConfig {
	return item.type === 'graphic-item' ? item.graphicItem : item;
}

export function featureMatchLayoutItemDefinition(item: FeatureMatchLayoutItemConfig) {
	const config = featureMatchLayoutItemGraphicItemConfig(item);
	return featureMatchGraphicItemDefinition(config.type);
}

export function featureMatchGraphicGroupChildGraphicItemConfig(
	child: FeatureMatchGraphicGroupChildConfig,
): Exclude<
	FeatureMatchGraphicItemDefinitionOwnedConfig,
	FeatureMatchSourceItemContentConfig | FeatureMatchGraphicGroupContentConfig
> {
	return child.type === 'graphic-item' ? child.graphicItem : child;
}

export function discoverFeatureMatchGraphicItemAssetReferences(
	config: FeatureMatchGraphicItemDefinitionOwnedConfig,
): GraphicItemAssetReferenceDiscovery[] {
	return featureMatchGraphicItemDefinition(config.type)
		.discoverAssetReferences(config as never);
}
