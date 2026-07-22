import type {
	MetagameCardBoardFilter,
	MetagameCardSortBy,
	MetagameScope,
	MetagameSortBy,
} from '~~/shared/types/enums';
import type {
	ArchetypeBreakdownResponse,
	ArchetypeDetailResponse,
	CardBreakdownResponse,
	CardDetailResponse,
	MetagameQueryParams,
	MetagameSummaryResponse,
	TokenRequirementsResponse,
} from '~~/shared/types/metagame';

export interface MetagameScopeInput {
	scope: MetagameScope;
	topN?: number;
	playerListId?: number;
}

export interface MetagameArchetypeBreakdownOptions {
	sortBy?: MetagameSortBy;
}

export interface MetagameCardBreakdownOptions {
	sortBy?: MetagameCardSortBy;
	limit?: number;
	board?: MetagameCardBoardFilter;
	archetypeId?: number;
	/** Legacy Screen config filter name; preserved while Screen config stores names instead of ids. */
	archetype?: string;
}

export interface MetagameArchetypeDetailOptions {
	board?: MetagameCardBoardFilter;
}

export function buildMetagameScopeQuery(input: MetagameScopeInput): MetagameQueryParams {
	const query: MetagameQueryParams = { scope: input.scope };
	if (input.scope === 'topN')
		query.topN = input.topN;
	if (input.scope === 'playerList' && input.playerListId != null)
		query.playerListId = input.playerListId;
	return query;
}

function buildArchetypeBreakdownQuery(
	scope: MetagameScopeInput,
	options: MetagameArchetypeBreakdownOptions = {},
) {
	return {
		...buildMetagameScopeQuery(scope),
		sortBy: options.sortBy ?? 'metaShare',
	};
}

function buildCardBreakdownQuery(
	scope: MetagameScopeInput,
	options: MetagameCardBreakdownOptions = {},
) {
	const archetype = options.archetype?.trim();

	return {
		...buildMetagameScopeQuery(scope),
		sortBy: options.sortBy ?? 'inclusionRate',
		limit: options.limit ?? 50,
		...(options.board ? { board: options.board } : {}),
		...(options.archetypeId != null ? { archetypeId: options.archetypeId } : {}),
		...(archetype ? { archetype } : {}),
	};
}

function buildArchetypeDetailQuery(
	scope: MetagameScopeInput,
	options: MetagameArchetypeDetailOptions = {},
) {
	return {
		...buildMetagameScopeQuery(scope),
		...(options.board ? { board: options.board } : {}),
	};
}

export function useMetagameClient() {
	const loadSummary = (eventId: number, scope: MetagameScopeInput) => {
		return $fetch<MetagameSummaryResponse>(
			`/api/events/${eventId}/metagame`,
			{ query: buildMetagameScopeQuery(scope) },
		);
	};

	const loadArchetypeBreakdown = (
		eventId: number,
		scope: MetagameScopeInput,
		options: MetagameArchetypeBreakdownOptions = {},
	) => {
		return $fetch<ArchetypeBreakdownResponse>(
			`/api/events/${eventId}/metagame/archetypes`,
			{ query: buildArchetypeBreakdownQuery(scope, options) },
		);
	};

	const loadCardBreakdown = (
		eventId: number,
		scope: MetagameScopeInput,
		options: MetagameCardBreakdownOptions = {},
	) => {
		return $fetch<CardBreakdownResponse>(
			`/api/events/${eventId}/metagame/cards`,
			{ query: buildCardBreakdownQuery(scope, options) },
		);
	};

	const loadArchetypeDetail = (
		eventId: number,
		archetypeId: number,
		scope: MetagameScopeInput,
		options: MetagameArchetypeDetailOptions = {},
	) => {
		return $fetch<ArchetypeDetailResponse>(
			`/api/events/${eventId}/metagame/archetypes/${archetypeId}`,
			{ query: buildArchetypeDetailQuery(scope, options) },
		);
	};

	const loadCardDetail = (
		eventId: number,
		cardId: number,
		scope: MetagameScopeInput,
	) => {
		return $fetch<CardDetailResponse>(
			`/api/events/${eventId}/metagame/cards/${cardId}`,
			{ query: buildMetagameScopeQuery(scope) },
		);
	};

	const loadTokenRequirements = (eventId: number, scope: MetagameScopeInput) => {
		return $fetch<TokenRequirementsResponse>(
			`/api/events/${eventId}/metagame/tokens`,
			{ query: buildMetagameScopeQuery(scope) },
		);
	};

	return {
		loadSummary,
		loadArchetypeBreakdown,
		loadCardBreakdown,
		loadArchetypeDetail,
		loadCardDetail,
		loadTokenRequirements,
	};
}
