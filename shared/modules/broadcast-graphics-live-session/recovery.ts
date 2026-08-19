import type { SupportedSocialNetwork } from '../../socialProfiles';
import type { NormalizedBroadcastGraphicInputsState } from './inputs';
import type { BroadcastGraphicsLiveState } from './playout';
import {
	canonicalSocialProfileUrl,
	MAX_SOCIAL_PROFILE_HANDLE_LENGTH,
	SUPPORTED_SOCIAL_NETWORK_BY_KEY,
	SUPPORTED_SOCIAL_NETWORK_KEYS,
} from '../../socialProfiles';
import { createInitialBroadcastGraphicInputsState } from './inputs';
import { createInitialBroadcastGraphicsLiveState } from './playout';
import { MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS } from './socialProfiles';

/**
 * What a reader does with durable live state it cannot trust.
 *
 * The Broadcast Graphics Live Session's state is one JSON column that survives
 * reloads, disconnections, and restarts, so every read of it is a read of
 * something written by another process — possibly a different build, possibly a
 * partial write. The settled rule is that missing, corrupt, or incompatible
 * durable live state renders every Broadcast Graphic transparent on every output
 * and shows Live Control a recovery fault that the first accepted command of any
 * type clears.
 *
 * Any type, because the fault is derived from the stored state on every read rather
 * than recorded: reduction starts from the recovered state and the projection writes
 * that reduction back, so whichever command is accepted first replaces the state
 * nobody could read with one anybody can. A Take is simply the command an operator
 * reaches for, not a requirement.
 *
 * ## Why it recovers to nothing rather than to what it could read
 *
 * Salvaging the readable half is the dangerous option: program would show
 * whichever graphics happened to survive parsing, at values nobody accepted, and
 * an operator would have no way to tell that from a show running normally.
 * Answering "nothing is on air, and here is why" is the only answer that is
 * always safe on air and always legible to the operator.
 *
 * ## Why it tolerates fields it does not know
 *
 * The state grows: Graphic Channels add a sibling to `playout`, animation adds
 * fields inside each playout record. A validator that refused anything
 * unrecognised would turn every one of those additions into a recovery fault on
 * every reader that had not been updated yet — a self-inflicted outage. So this
 * judges exactly the fields it reads and passes the rest through untouched.
 */

/**
 * Why durable live state could not be trusted.
 *
 * - `missing` — there is no state at all where there should be one.
 * - `corrupt` — the state is there but is not the shape of live state.
 * - `incompatible` — the shape is right but a value inside it is of a type this
 *   build cannot interpret, which is what a state written under a different
 *   vocabulary looks like from here.
 */
export const BROADCAST_GRAPHICS_RECOVERY_FAULT_REASONS = ['missing', 'corrupt', 'incompatible'] as const;

export type BroadcastGraphicsRecoveryFaultReason = typeof BROADCAST_GRAPHICS_RECOVERY_FAULT_REASONS[number];

/** A recovery fault, with enough detail to be diagnosable rather than merely fatal. */
export interface BroadcastGraphicsRecoveryFault {
	reason: BroadcastGraphicsRecoveryFaultReason;
	/** What could not be read, named so an operator can report it. */
	detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function fault(reason: BroadcastGraphicsRecoveryFaultReason, detail: string): BroadcastGraphicsRecoveryFault {
	return { reason, detail };
}

function playoutFault(playout: unknown): BroadcastGraphicsRecoveryFault | null {
	if (playout === undefined || playout === null)
		return null;
	if (!isRecord(playout))
		return fault('corrupt', 'the playout map is not a set of Broadcast Graphic records');

	for (const [graphicId, record] of Object.entries(playout)) {
		if (!isRecord(record))
			return fault('corrupt', `the playout record for ${graphicId} is not a record`);
		if ('onAir' in record && typeof record.onAir !== 'boolean')
			return fault('incompatible', `the on-air intent for ${graphicId} is not a true or false value`);
		if ('cut' in record && typeof record.cut !== 'boolean')
			return fault('incompatible', `the Cut modifier for ${graphicId} is not a true or false value`);
		// A start time that is not a number at all, which is a different thing from a
		// start time that is merely old. Animation deliberately trusts an old one
		// literally — the projection is monotone and saturating, so a start time from
		// before a crash has already passed its phase duration and settles at the
		// Graphic Resting State — and this must not second-guess that. But a
		// non-numeric value does not settle: it makes elapsed time NaN, and every
		// phase comparison against NaN is false, so an output would resolve a phase
		// nobody can predict. Refusing that is refusing corruption, not staleness.
		if ('effectiveStartedAt' in record && !Number.isFinite(record.effectiveStartedAt))
			return fault('incompatible', `the animation start time for ${graphicId} is not a number`);
	}

	return null;
}

function inputsFault(inputs: unknown): BroadcastGraphicsRecoveryFault | null {
	if (inputs === undefined || inputs === null)
		return null;
	if (!isRecord(inputs))
		return fault('corrupt', 'the Graphic Input map is not a set of Broadcast Graphic records');

	for (const [graphicId, record] of Object.entries(inputs)) {
		if (!isRecord(record))
			return fault('corrupt', `the Graphic Input record for ${graphicId} is not a record`);
		for (const slot of ['working', 'accepted'] as const) {
			if (slot in record && !isRecord(record[slot]))
				return fault('corrupt', `the ${slot} Graphic Input values for ${graphicId} are not a set of values`);
		}
		if ('acceptedRevision' in record && !Number.isFinite(record.acceptedRevision))
			return fault('incompatible', `the Graphic Input acceptance revision for ${graphicId} is not a number`);
	}

	return null;
}

/**
 * The third map, judged for the same reason as the other two.
 *
 * `sources` is a field this module *reads* — it normalises it on the way out — so
 * leaving it unjudged was not the deliberate tolerance of unknown fields above but a
 * gap. A record here is a Broadcast Graphic's Graphic Source Selections, and every
 * stored selection is an entity id: clearing one deletes its key rather than storing
 * an empty value, so a selection that is not a number is a value written under a
 * vocabulary this build cannot interpret.
 *
 * Unjudged, a null record read as no selections at all — every binding through it
 * silently unavailable on a live show — which is precisely the salvaged-half-a-state
 * answer the module refuses everywhere else. It also broke a promise another module
 * makes on this one's behalf: `BroadcastGraphicsLiveStateChange` uses `null` to mean
 * "this entry is gone", which is sound only while no entry can itself be null. See
 * #168.
 */
function sourcesFault(sources: unknown): BroadcastGraphicsRecoveryFault | null {
	if (sources === undefined || sources === null)
		return null;
	if (!isRecord(sources))
		return fault('corrupt', 'the Graphic Source Selection map is not a set of Broadcast Graphic records');

	for (const [graphicId, record] of Object.entries(sources)) {
		if (!isRecord(record))
			return fault('corrupt', `the Graphic Source Selection record for ${graphicId} is not a record`);
		for (const [sourceKey, selection] of Object.entries(record)) {
			if (!Number.isFinite(selection))
				return fault('incompatible', `the ${sourceKey} Graphic Source Selection for ${graphicId} does not name an entity`);
		}
	}

	return null;
}

function socialProfileProjectionsFault(projections: unknown): BroadcastGraphicsRecoveryFault | null {
	if (projections === undefined || projections === null)
		return null;
	if (!isRecord(projections))
		return fault('corrupt', 'the Social Profile Projection map is not a set of Broadcast Graphic records');

	const supportedNetworks = new Set<string>(SUPPORTED_SOCIAL_NETWORK_KEYS);
	const presentationLayersFault = (
		layers: unknown,
		identity: string,
		label: string,
	): BroadcastGraphicsRecoveryFault | null => {
		if (!Array.isArray(layers))
			return fault('corrupt', `${label} for ${identity} is not a list`);
		if (layers.length > MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS)
			return fault('incompatible', `${label} for ${identity} exceeds its bounded layer maximum`);

		const tuples = new Set<string>();
		for (const layer of layers) {
			if (!isRecord(layer) || !isRecord(layer.values))
				return fault('corrupt', `a layer in ${label} for ${identity} is not a record`);
			const values = layer.values;
			if (typeof values.network !== 'string' || !supportedNetworks.has(values.network))
				return fault('incompatible', `a network in ${label} for ${identity} is unsupported`);
			const network = values.network as SupportedSocialNetwork;
			const tupleIdentity = `${network}\u0000${String(values.handle)}`;
			if (
				typeof values.handle !== 'string'
				|| values.handle.length === 0
				|| values.handle.length > MAX_SOCIAL_PROFILE_HANDLE_LENGTH
				|| values.networkLabel !== SUPPORTED_SOCIAL_NETWORK_BY_KEY[network].label
				|| values.profileUrl !== canonicalSocialProfileUrl(network, values.handle)
				|| tuples.has(tupleIdentity)
				|| !isFiniteNumber(layer.opacity)
				|| layer.opacity < 0
				|| layer.opacity > 1
				|| !isFiniteNumber(layer.offsetX)
				|| Math.abs(layer.offsetX) > 100
				|| !isFiniteNumber(layer.offsetY)
				|| Math.abs(layer.offsetY) > 100
			) {
				return fault('incompatible', `a layer in ${label} for ${identity} is not correlated`);
			}
			tuples.add(tupleIdentity);
		}
		return null;
	};
	for (const [graphicId, graphic] of Object.entries(projections)) {
		if (!isRecord(graphic))
			return fault('corrupt', `the Social Profile Projection record for ${graphicId} is not a record`);
		for (const [projectionKey, projection] of Object.entries(graphic)) {
			const identity = `${graphicId}.${projectionKey}`;
			if (!isRecord(projection))
				return fault('corrupt', `the Social Profile Projection ${identity} is not a record`);
			if (!Array.isArray(projection.acceptedProfiles))
				return fault('corrupt', `the accepted Social Profiles for ${identity} are not a list`);
			if (projection.acceptedProfiles.length > SUPPORTED_SOCIAL_NETWORK_KEYS.length)
				return fault('incompatible', `the accepted Social Profiles for ${identity} exceed the supported catalog`);

			if ('talent' in projection) {
				if (!isRecord(projection.talent))
					return fault('corrupt', `the accepted Talent for ${identity} is not a record`);
				if (!Number.isFinite(projection.talent.id) || typeof projection.talent.name !== 'string')
					return fault('incompatible', `the accepted Talent for ${identity} cannot be interpreted`);
			}
			else if (
				projection.acceptedProfiles.length > 0
				|| 'currentNetwork' in projection
				|| 'manualNetwork' in projection
				|| 'rotationAnchor' in projection
			) {
				return fault('incompatible', `the Social Profile Projection ${identity} has no accepted Talent`);
			}

			const accepted = new Set<SupportedSocialNetwork>();
			let previousCatalogIndex = -1;
			for (const profile of projection.acceptedProfiles) {
				if (!isRecord(profile))
					return fault('corrupt', `an accepted Social Profile for ${identity} is not a record`);
				if (typeof profile.network !== 'string' || !supportedNetworks.has(profile.network))
					return fault('incompatible', `an accepted Social Profile network for ${identity} is unsupported`);
				const network = profile.network as SupportedSocialNetwork;
				const catalogIndex = SUPPORTED_SOCIAL_NETWORK_KEYS.indexOf(network);
				if (
					typeof profile.handle !== 'string'
					|| profile.handle.length === 0
					|| profile.handle.length > MAX_SOCIAL_PROFILE_HANDLE_LENGTH
					|| typeof profile.networkLabel !== 'string'
					|| typeof profile.profileUrl !== 'string'
					|| profile.networkLabel !== SUPPORTED_SOCIAL_NETWORK_BY_KEY[network].label
					|| profile.profileUrl !== canonicalSocialProfileUrl(network, profile.handle)
					|| accepted.has(network)
					|| catalogIndex <= previousCatalogIndex
				) {
					return fault('incompatible', `an accepted Social Profile tuple for ${identity} is not correlated`);
				}
				accepted.add(network);
				previousCatalogIndex = catalogIndex;
			}

			for (const field of ['currentNetwork', 'manualNetwork'] as const) {
				if (!(field in projection))
					continue;
				if (typeof projection[field] !== 'string' || !accepted.has(projection[field] as SupportedSocialNetwork))
					return fault('incompatible', `the ${field} for ${identity} is not an accepted Social Profile`);
			}

			if ('automatic' in projection && typeof projection.automatic !== 'boolean')
				return fault('incompatible', `Automatic for ${identity} is not a true or false value`);

			if ('rotationAnchor' in projection) {
				if (!isRecord(projection.rotationAnchor))
					return fault('corrupt', `the Social Profile Rotation anchor for ${identity} is not a record`);
				if (
					typeof projection.rotationAnchor.network !== 'string'
					|| !accepted.has(projection.rotationAnchor.network as SupportedSocialNetwork)
					|| !Number.isFinite(projection.rotationAnchor.anchoredAt)
				) {
					return fault('incompatible', `the Social Profile Rotation anchor for ${identity} cannot be interpreted`);
				}
			}

			for (const field of ['updateFrom', 'pendingUpdateFrom'] as const) {
				if (!(field in projection))
					continue;
				const snapshotFault = presentationLayersFault(
					projection[field],
					identity,
					`the ${field} Social Profile update snapshot`,
				);
				if (snapshotFault)
					return snapshotFault;
			}

			if ('transitionAnchor' in projection) {
				if (!isRecord(projection.transitionAnchor))
					return fault('corrupt', `the Social Profile Transition anchor for ${identity} is not a record`);
				const anchor = projection.transitionAnchor;
				if (!isFiniteNumber(anchor.startedAt))
					return fault('incompatible', `the Social Profile Transition anchor for ${identity} cannot be interpreted`);
				const anchorFault = presentationLayersFault(
					anchor.from,
					identity,
					'the interrupted Social Profile visual',
				);
				if (anchorFault)
					return anchorFault;
			}
		}
	}

	return null;
}

/**
 * Judge one durable live state, or report why it cannot be trusted.
 *
 * Answering `null` is the claim that every field this build reads is present in a
 * shape it can read — not that the state is exhaustively understood.
 */
export function broadcastGraphicsRecoveryFault(raw: unknown): BroadcastGraphicsRecoveryFault | null {
	if (raw === undefined || raw === null)
		return fault('missing', 'this Broadcast Graphics Live Session has no durable live state');
	if (!isRecord(raw))
		return fault('corrupt', 'the durable live state is not a live state record');

	return playoutFault(raw.playout)
		?? inputsFault(raw.inputs)
		?? sourcesFault(raw.sources)
		?? socialProfileProjectionsFault(raw.socialProfileProjections);
}

/**
 * The live state a reader should act on.
 *
 * Trustworthy state is returned as it is, extra fields and all. Anything else
 * becomes a fresh state — nothing on air, no accepted values — which is what
 * makes every output transparent while the fault stands.
 */
export function recoveredBroadcastGraphicsLiveState(raw: unknown): BroadcastGraphicsLiveState {
	if (broadcastGraphicsRecoveryFault(raw) !== null)
		return createInitialBroadcastGraphicsLiveState();

	const state = raw as Partial<BroadcastGraphicsLiveState>;
	return {
		...state,
		playout: state.playout ?? {},
		inputs: state.inputs ?? {},
		// Normalised like the other two: a session persisted before Graphic Source
		// Selections existed carries no such key, and every reader expects the map.
		sources: state.sources ?? {},
	} as BroadcastGraphicsLiveState;
}

/**
 * The state the next Broadcast Graphics Live Session opens with, given the one
 * that just ended.
 *
 * Playout never crosses an epoch boundary: ending a session turns every Broadcast
 * Graphic off, and a stale on-air intent surviving into a later show is exactly
 * what epochs exist to prevent. Prepared *working* values are the opposite case —
 * they are not an intent to show anything, they are the work an operator did to be
 * ready, and losing them to a mode change means retyping a show's lower thirds
 * mid-show.
 *
 * ## Why accepted values do not cross the boundary
 *
 * An accepted value is by definition what an on-air Broadcast Graphic *is
 * rendering*, and nothing is on air in a new epoch — so there is no rendering for
 * it to be the last accepted state of. Carrying it would not merely be redundant,
 * it would be unsound: acceptance falls back to the previously accepted value when
 * a working value is unavailable, and the Take gate measures requiredness against
 * what acceptance would produce. A required Graphic Input whose carried working
 * value is unavailable would therefore pass the gate on the strength of an
 * acceptance from a show that is over, and go on air showing the old epoch's value
 * — against the settled rule that a required unavailable Graphic Input prevents a
 * Take. Within one epoch that same fallback is correct, because there the last
 * accepted value really is what program is showing.
 *
 * The acceptance revision goes with it: it counts acceptances, and the new epoch
 * has had none.
 *
 * ## What crosses is what gets re-judged
 *
 * The line is not "prepared work crosses". It is that **state crossing this boundary
 * must be re-judged against current Event Data the next time it is used**, because
 * the boundary cannot tell an incidental mode change during one show from the gap
 * between two shows.
 *
 * A Graphic Source Selection crosses. It stores an entity id, and every binding
 * reading it re-resolves from current Event Data on every read: if the entity is
 * gone the binding is unavailable and a required input blocks the Take, and if it is
 * present the operator sees which entity in the picker that generated it. It is also
 * the control that costs most to redo — one per graphic, and the first thing an
 * operator sets.
 *
 * A **Graphic Input Override does not cross.** It is a frozen literal whose entire
 * purpose is to outrank the binding, so it is the one piece of carried state that can
 * neither be re-resolved nor become unavailable. Carried into a later show it would
 * suppress a binding that is resolving a *different* entity perfectly correctly, and
 * put the previous show's value on program — the mirror of the rule that a value
 * whose source no longer resolves must not be taken again, except that here nothing
 * is unavailable, so nothing catches it. Its only signal would be an `overridden`
 * badge on a field the operator never touched this show, which is opt-out at exactly
 * the moment attention is elsewhere.
 *
 * Carrying the correction would save re-typing it after an incidental mode flip.
 * That is a real cost, and it is the smaller one: an operator who wants the previous
 * show's corrections can re-enter them, and an operator who does not want them has no
 * way to discover they are there.
 *
 * Accepted values do not cross for their own reason, above. Note that the guarantee
 * there is structural rather than argued: every entry is rebuilt from
 * `createInitialBroadcastGraphicInputsState()`, so `accepted` and `acceptedRevision`
 * are empty in the new epoch whatever the Take gate later decides to consult.
 *
 * State that cannot be trusted carries nothing forward: the same reasoning that
 * refuses to salvage half a playout map refuses to salvage half an input map.
 */
export function carriedForwardBroadcastGraphicsLiveState(raw: unknown): BroadcastGraphicsLiveState {
	const recovered = recoveredBroadcastGraphicsLiveState(raw);

	// Both constructions below assign their overrides onto a fresh factory result
	// rather than writing them beside a spread of one. `{ ...factory(), key: … }` is
	// correct as written — the override is last, so it wins — but both factories
	// return a bare one-line literal, which rolldown is free to inline into the same
	// object literal; the emitted chunk then carries the key twice and warns
	// (`duplicate-object-key`, visible only in wrangler's esbuild pass). #324 found
	// four of those and #338 fixed the same shape in the Shape Geometry presets.
	// Neither site here warns today; keeping the factory out of the literal is what
	// makes the form immune rather than merely currently-correct (#348).
	//
	// The `satisfies` clause is what keeps the override honest. `Object.assign` takes
	// its second argument by assignability, so on its own it would let a mistyped or
	// invented key through in silence. On the return below that check is one the
	// spread already had, from the declared return type; on the per-graphic state it
	// is new, because an object literal built inside `Object.fromEntries(…map(…))`
	// has no contextual type and nothing was checking its keys at all.
	const inputs = Object.fromEntries(
		Object.entries(recovered.inputs).map(([graphicId, stored]) => [graphicId, Object.assign(
			createInitialBroadcastGraphicInputsState(),
			{ working: stored.working ?? {} } satisfies Partial<NormalizedBroadcastGraphicInputsState>,
		)]),
	);

	return Object.assign(createInitialBroadcastGraphicsLiveState(), {
		inputs,
		sources: recovered.sources ?? {},
	} satisfies Partial<BroadcastGraphicsLiveState>);
}
