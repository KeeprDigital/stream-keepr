import type { GraphicSourceSelectionsState } from '../graphics';
import type { BroadcastGraphicInputsState } from './inputs';
import type { BroadcastGraphicPlayout, BroadcastGraphicsLiveState } from './playout';
import type { BroadcastGraphicSocialProfileProjectionStates } from './socialProfiles';

/**
 * What one accepted command changed, in the form a peer can apply.
 *
 * ## Why the notification stopped carrying the whole live state
 *
 * `broadcastGraphicsLiveSession:commandApplied` used to publish the entire
 * `BroadcastGraphicsLiveState`. Live state grows with the show — five Graphic
 * Input value maps per placed Broadcast Graphic — so at the sizes the authoring
 * caps admit that message ran to hundreds of kilobytes against a realtime
 * per-message limit measured in tens, and it failed silently: publication logs and
 * swallows, so the write landed and only the notification stopped. See #168.
 *
 * The settled rule is that realtime is notification and snapshots are authority,
 * and the Screen half of this (#95) took it literally: name the thing that changed
 * and let every client reload. That answer is right there and wrong here. A Screen
 * changes when an author saves; live state changes on *every* accepted command, so
 * a reload-per-command would put a snapshot fetch between an operator pressing Take
 * and program showing it — for every Live Control and every Screen Output at once,
 * on the one path that has to be immediate. Worse, the animation would not merely be
 * late: every output projects a phase from one authoritative start time, so an output
 * that spends a round trip fetching joins the entrance already part-played rather than
 * at its first frame.
 *
 * So the notification carries the *difference* instead. It is bounded by what one
 * command can touch rather than by the size of the show, it costs no round trip, and
 * where even the difference is too large to deliver — one acceptance of a
 * maximally-declared Broadcast Graphic exceeds the limit on its own — the payload is
 * dropped and the peer reloads. That last case is what makes the message bounded by
 * construction rather than by argument.
 *
 * ## Why it names entries rather than whole Broadcast Graphics or single fields
 *
 * The description is one entry of one map: `playout` for this Broadcast Graphic,
 * `inputs` for that one. Each of the three maps is keyed by Broadcast Graphic id, so
 * this is the granularity live state itself is built at — a reducer cannot drift away
 * from it, and no reader has to know what is inside an entry.
 *
 * Naming whole Broadcast Graphics instead would be coarser than the commands are: a
 * Take and an Out change only a playout record, and pairing that with the graphic's
 * Graphic Input state would put a show's worth of accepted text behind every
 * on-air action — the one path that must not spend a round trip.
 *
 * Going finer — inside a Graphic Input state, naming the individual values a command
 * touched — would buy one more case, an edit to a Broadcast Graphic holding more than
 * eleven Graphic Inputs with every value map full at maximal length, and would cost a
 * second description with its own removal rules over a shape the reducer is free to
 * grow. That case falls back to a snapshot reload instead, and where the boundary
 * sits is measured rather than assumed: see
 * `test/unit/server/mappers/broadcastGraphicsCommandApplied.test.ts`.
 */

/**
 * The entries of one live-state map that changed, by Broadcast Graphic id.
 *
 * `null` is a removal. No entry in any of these maps is ever null — recovery refuses
 * a durable live state in which one is — so the sentinel cannot be confused for a
 * value, and "set what you are given, remove what is null" is the whole of applying a
 * change. `broadcastGraphicsLiveStateChange` checks rather than assumes it, because
 * the rule is enforced a module away and was once enforced for only two of the three
 * maps described here.
 */
export type BroadcastGraphicsLiveStateEntries<TEntry> = Record<string, TEntry | null>;

/** What one accepted command changed, map by map. An absent map changed nothing. */
export interface BroadcastGraphicsLiveStateChange {
	playout?: BroadcastGraphicsLiveStateEntries<BroadcastGraphicPlayout>;
	inputs?: BroadcastGraphicsLiveStateEntries<BroadcastGraphicInputsState>;
	sources?: BroadcastGraphicsLiveStateEntries<GraphicSourceSelectionsState>;
	socialProfileProjections?: BroadcastGraphicsLiveStateEntries<BroadcastGraphicSocialProfileProjectionStates>;
}

/** The maps a change describes. Everything else in live state is passed through. */
const CHANGED_MAPS = ['playout', 'inputs', 'sources', 'socialProfileProjections'] as const;

type LiveStateMap = typeof CHANGED_MAPS[number];

function mapOf(state: BroadcastGraphicsLiveState, map: LiveStateMap): Record<string, unknown> {
	return state[map] ?? {};
}

/**
 * Whether two entries are the same as far as a reader is concerned.
 *
 * Compared as serialized JSON rather than by reference, because the committed state
 * is read back from storage and shares no references with the state it was reduced
 * from. The comparison is allowed to be wrong in exactly one direction: two entries
 * that differ only in key order are reported changed and cost a few extra bytes,
 * while a real difference can never be missed — which is the direction that matters,
 * since a missed difference would leave a peer holding state the server does not have.
 */
function same(before: unknown, after: unknown): boolean {
	return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
}

/**
 * Everything in live state that a change has no room for.
 *
 * Live state deliberately passes fields this build does not recognise through
 * untouched, so recovery does not turn every future addition into an outage. The same
 * tolerance means a difference can sit somewhere this description cannot express, and
 * the honest answer to that is not to describe it — see `broadcastGraphicsLiveStateChange`.
 */
function passedThrough(state: BroadcastGraphicsLiveState): Record<string, unknown> {
	const {
		playout: _playout,
		inputs: _inputs,
		sources: _sources,
		socialProfileProjections: _socialProfileProjections,
		...rest
	} = state;
	return rest;
}

/**
 * How one accepted command changed the live state, or `null` when it cannot be said.
 *
 * `null` is not a failure: it means the difference is not expressible as entries of
 * the three maps, which is what a live state carrying a field this build does not know
 * about looks like. A peer given no change reloads the authoritative snapshot, which is
 * the answer that is always correct and merely costs a fetch.
 */
export function broadcastGraphicsLiveStateChange(
	before: BroadcastGraphicsLiveState,
	after: BroadcastGraphicsLiveState,
): BroadcastGraphicsLiveStateChange | null {
	if (!same(passedThrough(before), passedThrough(after)))
		return null;

	const change: BroadcastGraphicsLiveStateChange = {};

	for (const map of CHANGED_MAPS) {
		const from = mapOf(before, map);
		const to = mapOf(after, map);
		const entries: BroadcastGraphicsLiveStateEntries<unknown> = {};

		for (const graphicId of new Set([...Object.keys(from), ...Object.keys(to)])) {
			// The no-null rule this description depends on is enforced by recovery, one
			// module away, and it was once enforced for two of these three maps — which
			// made a null Graphic Source Selection record indistinguishable from an
			// absent one and left a peer permanently behind with nothing to notice it
			// by. Refusing to describe a state that breaks the promise costs a reload;
			// reading the null as a removal costs a divergence nothing heals.
			if (to[graphicId] === null)
				return null;
			if (same(from[graphicId], to[graphicId]))
				continue;
			entries[graphicId] = to[graphicId] === undefined ? null : to[graphicId];
		}

		if (Object.keys(entries).length > 0)
			(change as Record<string, unknown>)[map] = entries;
	}

	return change;
}

/**
 * The live state a peer holds after applying one command's change.
 *
 * The only way a client ever advances live state without reloading, and it has to
 * land on exactly what the server committed — every other reader converges through
 * the authoritative snapshot, so a peer that drifts here drifts alone and silently.
 */
export function changedBroadcastGraphicsLiveState(
	state: BroadcastGraphicsLiveState,
	change: BroadcastGraphicsLiveStateChange,
): BroadcastGraphicsLiveState {
	const next: BroadcastGraphicsLiveState = {
		...state,
		playout: { ...state.playout },
		inputs: { ...state.inputs },
		sources: { ...state.sources },
	};
	if (state.socialProfileProjections !== undefined || change.socialProfileProjections !== undefined)
		next.socialProfileProjections = { ...state.socialProfileProjections };

	for (const map of CHANGED_MAPS) {
		const entries = change[map];
		if (!entries)
			continue;

		for (const [graphicId, entry] of Object.entries(entries)) {
			if (entry === null)
				delete (next[map] as Record<string, unknown>)[graphicId];
			else
				(next[map] as Record<string, unknown>)[graphicId] = entry;
		}
	}

	return next;
}
