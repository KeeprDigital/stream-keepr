import type { EventKind } from '../../config/games';
import type { Game, Seat } from '../../types/enums';
import { EVENT_KIND_VALUES, eventSeats } from '../../config/games';
import { featureMatchTokenCatalogue } from '../../featureMatchTokenCatalogue';
import { seatLabel } from '../../utils/featureMatchSidePlayer';

/**
 * Host Contract seam.
 *
 * The declaration a graphics Screen Mode supplies when it embeds the shared
 * compositor. It carries only what the compositor reads: which host it is, which
 * data contexts it can supply to a Graphic Item Definition, how many compositions
 * its authoring tree roots, and where a Graphic Text Template's placeholder values
 * come from. Capability outside the contract stays host-owned.
 *
 * Canvas defaults are deliberately absent — they already live on the Screen Mode
 * Definition as its graphics host, and one number wants one home.
 *
 * ## Every field has a consumer, and one deliberately absent field does not
 *
 * This seam was reduced on purpose when Broadcast Graphics was its only host, with
 * the note that Feature Match Overlay "should add each field when it has a real
 * consumer rather than inherit a shape guessed for it". Adopting it, three fields
 * earned their place and one did not:
 *
 * - `contextKinds` gates the definition palette. A Feature Match host supplies the
 *   Feature Match context, which is what makes the Clock, Player Life, and Game
 *   Wins Definitions offerable.
 * - `composition` decides whether the authoring tree roots a stack. A Broadcast
 *   Graphics Screen composes an ordered stack of Broadcast Graphics; a Feature
 *   Match Overlay renders exactly one Feature Match Layout for exactly one Feature
 *   Match Slot, so there is no stack to author, add to, reorder, or delete from.
 * - `textValues` decides where `{placeholder}` values come from, and therefore
 *   whether the inspector offers Graphic Input declarations at all. A Broadcast
 *   Graphic Template declares typed Graphic Inputs with a staged or live On-air
 *   Update Policy; a Feature Match Overlay declares none and binds host tokens
 *   instead. Making it one field rather than two makes the invalid combination
 *   unrepresentable: a host cannot be in host-token mode without a catalogue, and
 *   cannot author Graphic Inputs while in it.
 * - **Write semantics are not a field here.** The compositor never writes. The
 *   shared graphics editor does, and it reads where its edits go, what its item
 *   tree holds and which edits are forbidden from the Host Contract's editor half,
 *   `GraphicsEditorHostContract` in `app/modules/graphics/editor/host.ts`
 *   (ADR-0081). That half carries closures over a Screen's live editing state, so
 *   it lives app-side and reads this declaration as its `tree.host`, rather than
 *   adding fields here that the server would never read. Both hosts write
 *   instantly; what Broadcast Graphics stages is Graphic Inputs for an Update
 *   Graphic acceptance, which is live state rather than authoring, and
 *   `textValues` already says which host has them.
 *
 * Channels and staged playout need no field for the same reason: they live in the
 * Live workspace, which a Feature Match Overlay never renders. The compositor has
 * never known about them.
 */

export type GraphicsHostId = 'broadcast-graphics' | 'feature-match-overlay';

/** A data context a host can supply to a Graphic Item Definition. */
export type GraphicsContextKind = 'event' | 'feature-match';

/**
 * How many compositions the host's authoring tree roots.
 *
 * `stack` roots an ordered, author-editable stack of Broadcast Graphics. `single`
 * roots exactly one composition the host owns: it is still passed to the
 * compositor as a stack of one, because the render model composes a stack and one
 * is a stack, but nothing offers to add, reorder, or remove a member.
 */
export type GraphicsHostComposition = 'stack' | 'single';

/**
 * A host-owned visual treatment for one otherwise textual placeholder value:
 * MTG mana pips for a colour string such as `WU`, One Piece colour pips for one
 * such as `Red/Green`, the One Piece card a Printing image URL shows, or the
 * Magic card a Scryfall image URL shows.
 */
export type GraphicsHostTokenPresentation = 'mtg-mana-colors' | 'op-colors' | 'op-card-image' | 'mtg-card-image';

/** One host-supplied placeholder a Graphic Text Template may name. */
export interface GraphicsHostToken {
	/** The stable key a `{token}` placeholder and a Graphic Placeholder Style name. */
	key: string;
	label: string;
	/**
	 * An optional application-owned presentation for this token's value, per Card
	 * Game: one token can hold a different game's value on each game's Events. A
	 * Card Game it does not name paints the value as text.
	 *
	 * The value remains text for template substitution, measurement, and authoring;
	 * the compositor only replaces that run's paint. This keeps a visual token from
	 * turning every ordinary Graphic Input with the same value into special markup.
	 */
	presentation?: Readonly<Partial<Record<Game, GraphicsHostTokenPresentation>>>;
}

/**
 * Where a Graphic Text Template's `{placeholder}` values come from.
 *
 * `graphic-inputs` resolves them from the typed Graphic Inputs the composition
 * declares, and the inspector offers those declarations. `host-tokens` resolves
 * them from a fixed catalogue the host supplies and the author cannot change, so
 * the inspector offers the catalogue to reference rather than controls to declare.
 */
export type GraphicsHostTextValues
	= | { kind: 'graphic-inputs' }
		| { kind: 'host-tokens'; catalogue: readonly GraphicsHostToken[] };

export interface GraphicsHostContract {
	hostId: GraphicsHostId;
	contextKinds: readonly GraphicsContextKind[];
	composition: GraphicsHostComposition;
	textValues: GraphicsHostTextValues;
	/**
	 * The Seats whose live state this host supplies, each as an author reads it:
	 * what a Definition reading one Seat is offered. Absent where the host supplies
	 * no Feature Match context.
	 */
	seats?: readonly GraphicsHostSeat[];
}

/** One Seat a host supplies live state for, as its author names it. */
export interface GraphicsHostSeat {
	seat: Seat;
	label: string;
}

export const BROADCAST_GRAPHICS_HOST_CONTRACT: GraphicsHostContract = {
	hostId: 'broadcast-graphics',
	contextKinds: ['event'],
	composition: 'stack',
	textValues: { kind: 'graphic-inputs' },
};

const FEATURE_MATCH_OVERLAY_HOST_CONTRACTS = Object.fromEntries(EVENT_KIND_VALUES.map(kind => [
	kind,
	{
		hostId: 'feature-match-overlay',
		contextKinds: ['event', 'feature-match'],
		composition: 'single',
		textValues: {
			kind: 'host-tokens',
			catalogue: featureMatchTokenCatalogue(kind),
		},
		seats: eventSeats(kind).map(seat => ({
			seat,
			label: seatLabel(kind, seat),
		})),
	},
])) as unknown as Readonly<Record<EventKind, GraphicsHostContract>>;

/**
 * A Feature Match Overlay declares the Feature Match context as well as the Event
 * one: the Clock, Player Life, and Game Wins Definitions require it, and its token
 * catalogue reads both a Feature Match Session and current Event Data. Its
 * catalogue and its Seats are its Event's: a Commander Event is offered four
 * Seats and their tokens (ADR-0087). One contract per kind, so a reader may
 * compare by identity.
 */
export function featureMatchOverlayHostContract(kind: EventKind): GraphicsHostContract {
	return FEATURE_MATCH_OVERLAY_HOST_CONTRACTS[kind];
}

/** A Two-Player Magic: The Gathering Event's Feature Match Overlay contract. */
export const FEATURE_MATCH_OVERLAY_HOST_CONTRACT: GraphicsHostContract = featureMatchOverlayHostContract('mtg-two-player');

/** The placeholder keys this host offers, when the host supplies them itself. */
export function graphicsHostTokenCatalogue(
	contract: GraphicsHostContract,
): readonly GraphicsHostToken[] {
	return contract.textValues.kind === 'host-tokens'
		? contract.textValues.catalogue
		: [];
}

/**
 * Whether this host's compositions declare their own typed Graphic Inputs.
 *
 * Derived rather than stored: a host either declares inputs or binds host tokens,
 * and storing both would let a contract say it does neither or both.
 */
export function authorsGraphicInputs(contract: GraphicsHostContract): boolean {
	return contract.textValues.kind === 'graphic-inputs';
}
