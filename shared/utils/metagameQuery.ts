import type {
	BoardSelection,
	MetagameCardSortBy,
	MetagameConversionMetric,
	MetagameScope,
	MetagameSortBy,
} from '~~/shared/types/enums';
import type { MetagameQueryParams } from '~~/shared/types/metagame';
import type { ArchetypeSpotlightModeConfig, MetagameModeConfig, TopCardsModeConfig } from '~~/shared/types/screenConfig';
import type { CardTypeBucket } from '~~/shared/utils/metagame';

/**
 * A Metagame Scope as a read takes it. A Screen's config is one as it stands,
 * since every metagame mode carries the shared scope fields (#777).
 */
export interface MetagameScopeInput {
	scope: MetagameScope;
	topN?: number;
	minPoints?: number;
	playerListId?: number;
}

/** Conversion target: how far a player must have made it to count as converted. */
export interface MetagameConversionInput {
	conversionMetric?: MetagameConversionMetric;
	conversionThreshold?: number;
}

export interface MetagameArchetypeBreakdownOptions extends MetagameConversionInput {
	sortBy?: MetagameSortBy;
	limit?: number;
}

export interface MetagameCardBreakdownOptions {
	sortBy?: MetagameCardSortBy;
	limit?: number;
	board?: BoardSelection;
	archetypeId?: number;
	/** Legacy Screen config filter name; preserved while Screen config stores names instead of ids. */
	archetype?: string;
	/** Card-type buckets to drop server-side, before the limit applies. */
	excludeTypes?: CardTypeBucket[];
	/** Only cards the Event's points system points, before the limit applies. */
	pointedOnly?: boolean;
}

export interface MetagameArchetypeDetailOptions extends MetagameConversionInput {
	board?: BoardSelection;
}

/** The query naming a Metagame Scope: only the field its scope reads, so a Screen's other fields never reach it. */
export function buildMetagameScopeQuery(input: MetagameScopeInput): MetagameQueryParams {
	const query: MetagameQueryParams = { scope: input.scope };
	if (input.scope === 'topN')
		query.topN = input.topN;
	if (input.scope === 'minPoints' && input.minPoints != null)
		query.minPoints = input.minPoints;
	if (input.scope === 'playerList' && input.playerListId != null)
		query.playerListId = input.playerListId;
	return query;
}

function buildConversionQuery(options: MetagameConversionInput) {
	if (options.conversionMetric == null || options.conversionThreshold == null)
		return {};

	return {
		conversionMetric: options.conversionMetric,
		conversionThreshold: options.conversionThreshold,
	};
}

export function buildArchetypeBreakdownQuery(
	scope: MetagameScopeInput,
	options: MetagameArchetypeBreakdownOptions = {},
) {
	return {
		...buildMetagameScopeQuery(scope),
		sortBy: options.sortBy ?? 'metaShare',
		...(options.limit != null
			? { limit: options.limit }
			: {}),
		...buildConversionQuery(options),
	};
}

export function buildCardBreakdownQuery(
	scope: MetagameScopeInput,
	options: MetagameCardBreakdownOptions = {},
) {
	const archetype = options.archetype?.trim();

	return {
		...buildMetagameScopeQuery(scope),
		sortBy: options.sortBy ?? 'inclusionRate',
		limit: options.limit ?? 50,
		...(options.board
			? { board: options.board }
			: {}),
		...(options.archetypeId != null
			? { archetypeId: options.archetypeId }
			: {}),
		...(archetype
			? { archetype }
			: {}),
		...(options.excludeTypes?.length
			? {
					excludeTypes: options.excludeTypes.join(','),
				}
			: {}),
		...(options.pointedOnly
			? { pointedOnly: 'true' }
			: {}),
	};
}

export function buildArchetypeDetailQuery(
	scope: MetagameScopeInput,
	options: MetagameArchetypeDetailOptions = {},
) {
	return {
		...buildMetagameScopeQuery(scope),
		...(options.board
			? { board: options.board }
			: {}),
		...buildConversionQuery(options),
	};
}

/**
 * The breakdown a Metagame Screen renders, read off its configuration.
 *
 * The Screen Output's read derives its query here from the saved
 * configuration (#604), so a capability can only ever ask for the breakdown its
 * Screen publishes. The chart display reads the archetype table's breakdown.
 */
export function metagameScreenQuery(config: MetagameModeConfig) {
	return config.viewMode === 'cards'
		? {
				viewMode: 'cards' as const,
				query: buildCardBreakdownQuery(config, {
					sortBy: config.cardSortBy,
					limit: config.limit,
					archetype: config.archetypeFilter,
				}),
			}
		: {
				viewMode: 'archetype' as const,
				query: buildArchetypeBreakdownQuery(config, {
					sortBy: config.sortBy,
					limit: config.archetypeLimit ?? undefined,
					conversionMetric: config.conversionMetric,
					conversionThreshold: config.conversionThreshold,
				}),
			};
}

/**
 * The archetype detail an Archetype Spotlight Screen renders (#761), read off
 * its configuration: the archetype page's own query for the same scope, board
 * and conversion target, so the Screen shows that page's numbers. `null` while
 * no Archetype is picked.
 */
export function archetypeSpotlightScreenQuery(config: ArchetypeSpotlightModeConfig) {
	if (config.archetypeId == null)
		return null;

	return {
		archetypeId: config.archetypeId,
		query: buildArchetypeDetailQuery(
			config,
			{ board: config.board, conversionMetric: config.conversionMetric, conversionThreshold: config.conversionThreshold },
		),
	};
}

/**
 * The card breakdown a Most Played Cards Screen renders, read off its
 * configuration. Ranking pointed cards only keeps nonbasic lands in, since a
 * pointed land is as much a pointed pick as any other card.
 */
export function topCardsScreenQuery(config: TopCardsModeConfig) {
	return buildCardBreakdownQuery(
		config,
		{
			sortBy: config.sortBy,
			limit: config.limit,
			board: config.board,
			archetype: config.archetypeFilter,
			excludeTypes: config.pointedOnly
				? config.excludedCardTypes.filter(type => type !== 'Land')
				: config.excludedCardTypes,
			pointedOnly: config.pointedOnly,
		},
	);
}
