import type {
	ArchetypeBreakdownResponse,
	ArchetypeDetailResponse,
	CardBreakdownResponse,
	CardDetailResponse,
	MetagameSummaryResponse,
	TokenRequirementsResponse,
} from '~~/shared/types/metagame';
import type {
	MetagameArchetypeBreakdownOptions,
	MetagameArchetypeDetailOptions,
	MetagameCardBreakdownOptions,
	MetagameScopeInput,
} from '~~/shared/utils/metagameQuery';
import {
	buildArchetypeBreakdownQuery,
	buildArchetypeDetailQuery,
	buildCardBreakdownQuery,
	buildMetagameScopeQuery,
} from '~~/shared/utils/metagameQuery';

export type {
	MetagameArchetypeBreakdownOptions,
	MetagameArchetypeDetailOptions,
	MetagameCardBreakdownOptions,
	MetagameConversionInput,
	MetagameScopeInput,
} from '~~/shared/utils/metagameQuery';
export { buildMetagameScopeQuery } from '~~/shared/utils/metagameQuery';

export function useMetagameClient() {
	const loadSummary = (eventId: number, scope: MetagameScopeInput) => {
		return $fetch<MetagameSummaryResponse>(
			`/api/events/${eventId}/metagame`,
			{
				query: buildMetagameScopeQuery(scope),
			},
		);
	};

	const loadArchetypeBreakdown = (
		eventId: number,
		scope: MetagameScopeInput,
		options: MetagameArchetypeBreakdownOptions = {},
	) => {
		return $fetch<ArchetypeBreakdownResponse>(
			`/api/events/${eventId}/metagame/archetypes`,
			{
				query: buildArchetypeBreakdownQuery(scope, options),
			},
		);
	};

	const loadCardBreakdown = (
		eventId: number,
		scope: MetagameScopeInput,
		options: MetagameCardBreakdownOptions = {},
	) => {
		return $fetch<CardBreakdownResponse>(
			`/api/events/${eventId}/metagame/cards`,
			{
				query: buildCardBreakdownQuery(scope, options),
			},
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
			{
				query: buildArchetypeDetailQuery(scope, options),
			},
		);
	};

	const loadCardDetail = (
		eventId: number,
		cardId: number,
		scope: MetagameScopeInput,
	) => {
		return $fetch<CardDetailResponse>(
			`/api/events/${eventId}/metagame/cards/${cardId}`,
			{
				query: buildMetagameScopeQuery(scope),
			},
		);
	};

	const loadTokenRequirements = (eventId: number, scope: MetagameScopeInput) => {
		return $fetch<TokenRequirementsResponse>(
			`/api/events/${eventId}/metagame/tokens`,
			{
				query: buildMetagameScopeQuery(scope),
			},
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
