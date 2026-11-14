import type { EventKind } from './config/games';
import type { Seat } from './types/enums';
import type { GraphicGroupChildConfig, GraphicItemConfig } from './types/graphics';
import type { FeatureMatchLayoutConfig } from './types/screenConfig';
import { FEATURE_MATCH_TOKEN_SEATS, featureMatchTokenCatalogue } from './featureMatchTokenCatalogue';
import { graphicTextTemplateInputKeys } from './modules/graphics/textTemplate';
import { PLAYER_SIDE_VALUES } from './types/enums';

/**
 * Which Events a Feature Match Layout is for, read from what it names.
 *
 * A layout naming a third or fourth Seat, or anything only a Commander Event
 * holds, is a four-Seat layout, offered to Commander Events alone; every other
 * layout is offered to every other Event. Its content decides, and nothing
 * declares it (ADR-0087).
 */

const PAIR: readonly string[] = PLAYER_SIDE_VALUES;

/** The tokens only a Commander Event is offered: its Commanders' images. */
const COMMANDER_TOKENS: ReadonlySet<string> = new Set(featureMatchTokenCatalogue('mtg-commander')
	.map(token => token.key)
	.filter(key => !featureMatchTokenCatalogue('mtg-two-player').some(token => token.key === key)));

function isBeyondThePair(seat: Seat | undefined): boolean {
	return seat !== undefined && !PAIR.includes(seat);
}

/** Whether one Graphic Item names a third or fourth Seat, or a Commander term. */
function namesAFourSeatTerm(item: GraphicItemConfig | GraphicGroupChildConfig): boolean {
	if (item.type === 'group')
		return item.children.some(namesAFourSeatTerm);
	// Commander Damage, and an Eliminated Seat, are a Commander game's alone.
	if (item.type === 'commander-damage' || (item.type === 'seat-indicator' && item.state === 'eliminated'))
		return true;
	if (item.type === 'text') {
		return [
			...graphicTextTemplateInputKeys(item.text),
			...Object.keys(item.placeholderStyles ?? {}),
		]
			.some(key => isBeyondThePair(FEATURE_MATCH_TOKEN_SEATS[key]) || COMMANDER_TOKENS.has(key));
	}
	return 'playerSide' in item && isBeyondThePair(item.playerSide);
}

/** Whether a layout is a four-Seat layout: it names a third or fourth Seat, or a Commander term. */
export function isFourSeatFeatureMatchLayout(layout: Pick<FeatureMatchLayoutConfig, 'sources' | 'composition'>): boolean {
	return layout.sources.some(source => source.sourceRole !== 'main' && isBeyondThePair(source.sourceRole))
		|| layout.composition.items.some(namesAFourSeatTerm);
}

/** Whether a layout, four-Seat or not, is offered to an Event of this kind: a four-Seat one to a Commander Event alone, any other to every other Event. */
export function isFourSeatLayoutOfferedTo(fourSeat: boolean, kind: EventKind): boolean {
	return fourSeat === (kind === 'mtg-commander');
}

/** Whether a layout is offered to an Event of this kind, by what it names. */
export function isFeatureMatchLayoutOfferedTo(layout: Pick<FeatureMatchLayoutConfig, 'sources' | 'composition'>, kind: EventKind): boolean {
	return isFourSeatLayoutOfferedTo(isFourSeatFeatureMatchLayout(layout), kind);
}
