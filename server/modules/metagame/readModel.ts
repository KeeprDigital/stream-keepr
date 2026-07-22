import type { MetagameCardBoardFilter, MetagameCardSortBy, MetagameScope, MetagameSortBy } from '~~/shared/types/enums';
import { createMetagameReadModelImplementation } from './readModelImplementation';

export type { MetagameDeckUniverse, MetagameScopeModel } from './scopeModel';

export interface MetagameScopeQuery {
	scope: MetagameScope;
	topN?: number;
	playerListId?: number;
}

export interface MetagameArchetypeBreakdownQuery extends MetagameScopeQuery {
	sortBy?: MetagameSortBy;
}

export interface MetagameCardBreakdownQuery extends MetagameScopeQuery {
	sortBy?: MetagameCardSortBy;
	limit?: number;
	archetypeId?: number;
	board?: MetagameCardBoardFilter;
	archetype?: string;
}

export interface MetagameArchetypeDetailQuery extends MetagameScopeQuery {
	archetypeId: number;
	board?: MetagameCardBoardFilter;
}

export interface MetagameCardDetailQuery extends MetagameScopeQuery {
	cardId: number;
}

export type MetagameTokenRequirementsQuery = MetagameScopeQuery;

/**
 * Metagame read model seam.
 *
 * Route callers pass domain-shaped query objects through this interface instead
 * of learning the positional argument order of the underlying aggregate
 * implementation. Aggregate query construction now lives behind this module;
 * the legacy service is only a compatibility adapter.
 */
export function metagameReadModel() {
	const implementation = createMetagameReadModelImplementation();

	return {
		getSummary(eventId: number, query: MetagameScopeQuery) {
			return implementation.getSummary(eventId, query.scope, query.topN, query.playerListId);
		},
		getArchetypeBreakdown(eventId: number, query: MetagameArchetypeBreakdownQuery) {
			return implementation.getArchetypeBreakdown(eventId, query.scope, query.sortBy, query.topN, query.playerListId);
		},
		getCardBreakdown(eventId: number, query: MetagameCardBreakdownQuery) {
			return implementation.getCardBreakdown(
				eventId,
				query.scope,
				query.sortBy,
				query.limit,
				query.topN,
				query.playerListId,
				query.archetypeId,
				query.board,
				query.archetype,
			);
		},
		getArchetypeDetail(eventId: number, query: MetagameArchetypeDetailQuery) {
			return implementation.getArchetypeDetail(
				eventId,
				query.archetypeId,
				query.scope,
				query.topN,
				query.playerListId,
				query.board,
			);
		},
		getCardDetail(eventId: number, query: MetagameCardDetailQuery) {
			return implementation.getCardDetail(eventId, query.cardId, query.scope, query.topN, query.playerListId);
		},
		getTokenRequirements(eventId: number, query: MetagameTokenRequirementsQuery) {
			return implementation.getTokenRequirements(eventId, query.scope, query.topN, query.playerListId);
		},
	};
}
