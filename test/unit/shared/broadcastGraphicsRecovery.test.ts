import type { GraphicInputDeclaration } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	broadcastGraphicsRecoveryFault,
	carriedForwardBroadcastGraphicsLiveState,
	createInitialBroadcastGraphicsLiveState,
	onAirBroadcastGraphicIds,
	recoveredBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * Recovery from durable live state that cannot be trusted.
 *
 * The operator-visible rule is one sentence: missing, corrupt, or incompatible
 * durable live state renders every graphic transparent on every output, and the
 * only way back on air is an explicit Take. Both halves are asserted here — the
 * fault is reported so Live Control can say so, and the state a reader gets has
 * nothing on air.
 */
describe('broadcastGraphicsRecovery', () => {
	describe('state a reader can trust', () => {
		it('reports no fault for the state a fresh epoch opens with', () => {
			expect(broadcastGraphicsRecoveryFault(createInitialBroadcastGraphicsLiveState())).toBeNull();
		});

		it('reports no fault for a state carrying accepted playout and Graphic Inputs', () => {
			const state = {
				playout: { slate: { onAir: true }, bug: { onAir: false } },
				inputs: { slate: { working: { name: 'Ava' }, accepted: { name: 'Ava' }, acceptedRevision: 2 } },
			};

			expect(broadcastGraphicsRecoveryFault(state)).toBeNull();
			// The three maps a reader indexes are filled in when absent; everything else is
			// returned untouched.
			expect(recoveredBroadcastGraphicsLiveState(state)).toEqual({ ...state, sources: {} });
		});

		it('tolerates an empty object, which is a session that has accepted nothing', () => {
			expect(broadcastGraphicsRecoveryFault({})).toBeNull();
			expect(recoveredBroadcastGraphicsLiveState({})).toEqual(createInitialBroadcastGraphicsLiveState());
		});

		it('trusts a real persisted record produced by the reducer itself', () => {
			// Built by the reducer and round-tripped as JSON, which is exactly what a
			// reload, a restart, or a second process reads. Asserting against a
			// hand-written fixture would keep passing after the persisted shape moved on
			// — the fixture would still describe a record nothing produces — so the
			// record under test is the real one.
			const persisted = JSON.parse(JSON.stringify(applyBroadcastGraphicsCommand(
				createInitialBroadcastGraphicsLiveState(),
				{ type: 'Take', payload: { graphicId: 'slate' } },
				{ inputs: [], acceptedAt: 1_700_000_000_000 },
			)));

			expect(broadcastGraphicsRecoveryFault(persisted)).toBeNull();
			expect(recoveredBroadcastGraphicsLiveState(persisted)).toEqual(persisted);
			// And it really does carry the animation timing this validator must not judge.
			expect(Object.keys(persisted.playout.slate).toSorted())
				.toEqual(['cut', 'effectiveStartedAt', 'onAir']);
			expect(onAirBroadcastGraphicIds(persisted, [{ id: 'slate' }])).toEqual(['slate']);
		});

		it('passes through fields it does not interpret rather than calling them a fault', () => {
			// Later playout vocabulary — Graphic Channels — adds siblings this build has
			// never seen. A reader that refused anything unrecognised would turn every
			// such addition into a recovery fault on every reader that had not caught up,
			// so the validator judges only what it reads.
			const state = {
				playout: { slate: { onAir: true, effectiveStartedAt: 1_700_000_000_000, cut: false } },
				inputs: {},
				channels: { lower: 'slate' },
			};

			expect(broadcastGraphicsRecoveryFault(state)).toBeNull();
			// `channels` survives untouched, which is the point; `sources` is one of the
			// maps the reader indexes, so it is filled in rather than left absent.
			expect(recoveredBroadcastGraphicsLiveState(state)).toEqual({ ...state, sources: {} });
		});
	});

	describe('missing durable live state', () => {
		it.each([
			['null', null],
			['undefined', undefined],
		])('reports %s as missing', (_label, raw) => {
			expect(broadcastGraphicsRecoveryFault(raw)?.reason).toBe('missing');
		});

		it('recovers with every Broadcast Graphic off, so every output is transparent', () => {
			const recovered = recoveredBroadcastGraphicsLiveState(null);

			expect(recovered).toEqual(createInitialBroadcastGraphicsLiveState());
			expect(onAirBroadcastGraphicIds(recovered, [{ id: 'slate' }, { id: 'bug' }])).toEqual([]);
		});
	});

	describe('corrupt durable live state', () => {
		it.each([
			['a string', '{"playout":'],
			['a number', 7],
			['an array', [{ onAir: true }]],
			['a non-object playout map', { playout: 'slate', inputs: {} }],
			['a non-object inputs map', { playout: {}, inputs: 3 }],
			['a non-object playout record', { playout: { slate: true }, inputs: {} }],
			['a non-object inputs record', { playout: {}, inputs: { slate: 'Ava' } }],
			['a non-object working map', { playout: {}, inputs: { slate: { working: 'Ava', accepted: {} } } }],
		])('reports %s as corrupt', (_label, raw) => {
			expect(broadcastGraphicsRecoveryFault(raw)?.reason).toBe('corrupt');
		});

		it('names what could not be read, so the fault is diagnosable rather than just fatal', () => {
			const fault = broadcastGraphicsRecoveryFault({ playout: { slate: true }, inputs: {} });

			expect(fault?.detail).toMatch(/slate/);
		});

		it('recovers with nothing on air rather than with the part it could read', () => {
			// Half-trusting a corrupt state is the failure mode this exists to prevent:
			// program would show whichever graphics happened to survive parsing.
			const recovered = recoveredBroadcastGraphicsLiveState({
				playout: { good: { onAir: true }, bad: 'yes' },
				inputs: {},
			});

			expect(onAirBroadcastGraphicIds(recovered, [{ id: 'good' }, { id: 'bad' }])).toEqual([]);
		});
	});

	describe('incompatible durable live state', () => {
		it.each([
			['an on-air intent that is not a boolean', { playout: { slate: { onAir: 'yes' } }, inputs: {} }],
			['an acceptance revision that is not a number', {
				playout: {},
				inputs: { slate: { working: {}, accepted: {}, acceptedRevision: '4' } },
			}],
			['a Cut modifier that is not a boolean', {
				playout: { slate: { onAir: true, effectiveStartedAt: 0, cut: 'yes' } },
				inputs: {},
			}],
			// Not a number at all, which is corruption rather than staleness: an old start
			// time settles at the Graphic Resting State by itself, while a non-numeric one
			// makes every phase comparison NaN-false and resolves a phase nobody predicted.
			['an animation start time that is not a number', {
				playout: { slate: { onAir: true, effectiveStartedAt: 'soon', cut: false } },
				inputs: {},
			}],
		])('reports %s as incompatible', (_label, raw) => {
			expect(broadcastGraphicsRecoveryFault(raw)?.reason).toBe('incompatible');
		});

		it('recovers with nothing on air', () => {
			const recovered = recoveredBroadcastGraphicsLiveState({ playout: { slate: { onAir: 'yes' } }, inputs: {} });

			expect(onAirBroadcastGraphicIds(recovered, [{ id: 'slate' }])).toEqual([]);
		});

		it('trusts a long-stale animation start time rather than calling it a fault', () => {
			// The complement of the rule above, and the one that matters more: animation
			// requires an old start time to be read literally, because the projection is
			// monotone and saturating and therefore settles it at the Graphic Resting
			// State by itself. Faulting it here would blank a show that is running
			// correctly — which is the opposite of what recovery is for.
			const ancient = { playout: { slate: { onAir: true, effectiveStartedAt: 1, cut: false } }, inputs: {} };

			expect(broadcastGraphicsRecoveryFault(ancient)).toBeNull();
			expect(onAirBroadcastGraphicIds(recoveredBroadcastGraphicsLiveState(ancient), [{ id: 'slate' }]))
				.toEqual(['slate']);
		});
	});

	describe('what survives ending one epoch and opening the next', () => {
		const ended = {
			playout: { slate: { onAir: true }, bug: { onAir: true } },
			inputs: { slate: { working: { name: 'Ava' }, accepted: { name: 'Ava' }, acceptedRevision: 3 } },
		};

		it('carries prepared working values forward while turning every graphic off', () => {
			// A Screen leaving and re-entering Broadcast Graphics mode ends one epoch and
			// opens another. Nothing may still be on air across that boundary, but the
			// values an operator prepared for the next take are not a playout intent and
			// are exactly what they would otherwise have to retype mid-show.
			const next = carriedForwardBroadcastGraphicsLiveState(ended);

			expect(next.playout).toEqual({});
			expect(next.inputs.slate?.working).toEqual({ name: 'Ava' });
			expect(onAirBroadcastGraphicIds(next, [{ id: 'slate' }, { id: 'bug' }])).toEqual([]);
		});

		it('carries Graphic Source Selections and Overrides forward with the prepared values', () => {
			// Both fall on the working-value side of the epoch boundary: a selection says
			// which Player a lower third is about, an override is a correction that persists
			// across hide and show cycles by definition, and neither is an intent to show
			// anything. Losing them to a mode change means re-picking every source and
			// re-typing every correction mid-show.
			const next = carriedForwardBroadcastGraphicsLiveState({
				...ended,
				sources: { slate: { player: 7 } },
				inputs: {
					slate: {
						working: { name: 'Ava' },
						overrides: { name: 'Ava "Riptide" Reed' },
						accepted: { name: 'Ava' },
						acceptedRevision: 3,
					},
				},
			});

			expect(next.sources).toEqual({ slate: { player: 7 } });
			expect(next.inputs.slate?.overrides).toEqual({ name: 'Ava "Riptide" Reed' });
			// And still nothing on air, and still no acceptance.
			expect(next.playout).toEqual({});
			expect(next.inputs.slate?.acceptedRevision).toBe(0);
		});

		it('carries no accepted value or acceptance revision into the new epoch', () => {
			// An accepted value is what an on-air graphic *is rendering*, and nothing is on
			// air here — so there is no rendering for it to be the last accepted state of.
			// It is also unsound to keep: acceptance falls back to the previously accepted
			// value when a working value is unavailable, and the Take gate measures
			// requiredness against what acceptance would produce, so a carried acceptance
			// would let a required unavailable input reach air on the strength of a show
			// that is over.
			const next = carriedForwardBroadcastGraphicsLiveState(ended);

			expect(next.inputs.slate?.accepted).toEqual({});
			expect(next.inputs.slate?.acceptedRevision).toBe(0);
		});

		it('still blocks Take on a required Graphic Input whose carried working value is unavailable', () => {
			const required: GraphicInputDeclaration = {
				type: 'text',
				key: 'name',
				label: 'Name',
				required: true,
				updatePolicy: 'staged',
				default: '',
				maxLength: 10,
			};
			const next = carriedForwardBroadcastGraphicsLiveState({
				playout: { slate: { onAir: true } },
				inputs: { slate: { working: { name: 'A'.repeat(50) }, accepted: { name: 'Ava' }, acceptedRevision: 2 } },
			});

			// The settled rule, asserted through the gate itself rather than through the
			// shape: a required unavailable Graphic Input prevents a Take.
			expect(() => applyBroadcastGraphicsCommand(
				next,
				{ type: 'Take', payload: { graphicId: 'slate' } },
				{ inputs: [required], acceptedAt: 1_700_000_000_000 },
			)).toThrow(expect.objectContaining({ code: 'required-input-unavailable' }));
		});

		it('carries nothing forward from state it cannot trust', () => {
			expect(carriedForwardBroadcastGraphicsLiveState({ playout: 'slate', inputs: { a: 1 } }))
				.toEqual(createInitialBroadcastGraphicsLiveState());
		});
	});
});
