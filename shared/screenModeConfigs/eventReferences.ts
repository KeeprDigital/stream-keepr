import type { ManualBracket } from '../modules/top-cut-bracket/manual';
import type { DeckSource } from './deck';

/**
 * What a field declared as each kind of Event Reference holds. A kind is what
 * the field names: a Phase, a Round, a Player, a Player List, a Feature Match
 * Slot, an Archetype or a Talent by id, a Talent lineup as an ordered list of
 * Talent ids, a whole Deck Source, which names a Player or a Broadcast Deck
 * List, or a whole Manual Bracket, whose entrants may each name a Player.
 * A config contract field names its kind (`reference`, ADR-0038).
 */
export interface EventReferenceValues {
	phase: EntityIdField;
	round: EntityIdField;
	player: EntityIdField;
	playerList: EntityIdField;
	featureMatchSlot: EntityIdField;
	archetype: EntityIdField;
	talent: EntityIdField;
	talentLineup: readonly number[] | undefined;
	deckSource: DeckSource | undefined;
	manualBracket: ManualBracket | undefined;
}

/** A field naming one entity by id, or none. */
type EntityIdField = number | null | undefined;

export type EventReferenceKind = keyof EventReferenceValues;

/** A mode's Event References: each config field naming something in the Screen's Event, and what it names. */
export type ScreenModeEventReferences = Readonly<Record<string, EventReferenceKind>>;
