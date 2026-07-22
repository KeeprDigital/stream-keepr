import type { Event, FeatureMatch, Match, Phase, Round } from '~/types';
import { getGameConfig } from '~~/shared/config/games';

export const FEATURE_MATCH_OVERLAY_TEMPLATE_TOKENS = ['name', 'record', 'deck', 'deckColors', 'pronouns', 'lgs', 'round', 'stage', 'table', 'format', 'eventName'] as const;

export interface FeatureMatchOverlayTemplateMetadataInput {
	event: Pick<Event, 'name' | 'game'> | null | undefined;
	featureMatch: Pick<FeatureMatch, 'tableNumber' | 'roundName' | 'formatName' | 'activeSession'> | null | undefined;
	sourceMatch: Pick<Match, 'tableNumber'> | null | undefined;
	round: Pick<Round, 'name'> | null | undefined;
	phase: Pick<Phase, 'name'> | null | undefined;
}

export interface FeatureMatchOverlayTemplateMetadataValues {
	round: string;
	stage: string;
	table: string;
	format: string;
	eventName: string;
}

export function buildFeatureMatchOverlayTemplateMetadataValues({
	event,
	featureMatch,
	sourceMatch,
	round,
	phase,
}: FeatureMatchOverlayTemplateMetadataInput): FeatureMatchOverlayTemplateMetadataValues {
	const tableNumber = featureMatch?.tableNumber
		?? sourceMatch?.tableNumber
		?? featureMatch?.activeSession?.sourceSnapshot.tableNumber;
	const roundName = featureMatch?.roundName
		?? featureMatch?.activeSession?.sourceSnapshot.roundName
		?? round?.name
		?? '';
	const phaseName = phase?.name ?? '';

	return {
		round: roundName,
		stage: phaseName || roundName,
		table: tableNumber ? `Table ${tableNumber}` : '',
		format: featureMatch?.formatName ?? featureMatch?.activeSession?.sourceSnapshot.formatName ?? (event?.game ? getGameConfig(event.game).label : ''),
		eventName: event?.name ?? '',
	};
}
