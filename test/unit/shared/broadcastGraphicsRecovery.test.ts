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
			expect(recoveredBroadcastGraphicsLiveState(state)).toEqual(state);
		});

		it('tolerates an empty object, which is a session that has accepted nothing', () => {
			expect(broadcastGraphicsRecoveryFault({})).toBeNull();
			expect(recoveredBroadcastGraphicsLiveState({})).toEqual(createInitialBroadcastGraphicsLiveState());
		});

		it('passes through fields it does not interpret rather than calling them a fault', () => {
			// Later playout vocabulary — channels, animation timing — adds siblings to
			// this state. A reader that refused anything it did not recognise would turn
			// every such addition into a recovery fault on every older reader, so the
			// validator judges only what it reads.
			const state = {
				playout: { slate: { onAir: true, effectiveStartedAt: 1_700_000_000_000 } },
				inputs: {},
				channels: { lower: 'slate' },
			};

			expect(broadcastGraphicsRecoveryFault(state)).toBeNull();
			expect(recoveredBroadcastGraphicsLiveState(state)).toEqual(state);
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
		])('reports %s as incompatible', (_label, raw) => {
			expect(broadcastGraphicsRecoveryFault(raw)?.reason).toBe('incompatible');
		});

		it('recovers with nothing on air', () => {
			const recovered = recoveredBroadcastGraphicsLiveState({ playout: { slate: { onAir: 'yes' } }, inputs: {} });

			expect(onAirBroadcastGraphicIds(recovered, [{ id: 'slate' }])).toEqual([]);
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
				{ inputs: [required] },
			)).toThrow(expect.objectContaining({ code: 'required-input-unavailable' }));
		});

		it('carries nothing forward from state it cannot trust', () => {
			expect(carriedForwardBroadcastGraphicsLiveState({ playout: 'slate', inputs: { a: 1 } }))
				.toEqual(createInitialBroadcastGraphicsLiveState());
		});
	});
});
