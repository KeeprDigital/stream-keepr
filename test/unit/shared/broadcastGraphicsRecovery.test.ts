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

const avaTwitch = {
	network: 'twitch',
	networkLabel: 'Twitch',
	handle: 'Ava',
	profileUrl: 'https://www.twitch.tv/Ava',
};

/** Durable live state holding one stored Social Profile Projection, `lower.profile`. */
function withProfile(profile: Record<string, unknown>) {
	return {
		playout: {},
		inputs: {},
		socialProfileProjections: {
			lower: { profile },
		},
	};
}

// Missing, corrupt or incompatible durable live state is reported as a fault and
// recovers with nothing on air; only an explicit Take puts a graphic back.
describe('broadcastGraphicsRecovery', () => {
	describe('state a reader can trust', () => {
		it('reports no fault for the state a fresh epoch opens with', () => {
			expect(broadcastGraphicsRecoveryFault(createInitialBroadcastGraphicsLiveState())).toBeNull();
		});

		it('reports no fault for a state carrying accepted playout and Graphic Inputs', () => {
			const state = {
				playout: {
					slate: { onAir: true },
					bug: { onAir: false },
				},
				inputs: {
					slate: {
						working: { name: 'Ava' },
						accepted: { name: 'Ava' },
						acceptedRevision: 2,
					},
				},
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
			// The real persisted record, built by the reducer and round-tripped as JSON.
			const persisted = JSON.parse(JSON.stringify(applyBroadcastGraphicsCommand(
				createInitialBroadcastGraphicsLiveState(),
				{
					type: 'Take',
					payload: { graphicId: 'slate' },
				},
				{ inputs: [], acceptedAt: 1_700_000_000_000 },
			)));

			expect(broadcastGraphicsRecoveryFault(persisted)).toBeNull();
			expect(recoveredBroadcastGraphicsLiveState(persisted)).toEqual(persisted);
			// And it really does carry the animation timing this validator must not judge.
			expect(Object.keys(persisted.playout.slate).toSorted())
				.toEqual(['cut', 'effectiveStartedAt', 'onAir']);
			expect(onAirBroadcastGraphicIds(persisted, [
				{ id: 'slate' },
			])).toEqual(['slate']);
		});

		it('passes through fields it does not interpret rather than calling them a fault', () => {
			// Later playout vocabulary — Graphic Channels — adds siblings this build has
			// never seen. A reader that refused anything unrecognised would turn every
			// such addition into a recovery fault on every reader that had not caught up,
			// so the validator judges only what it reads.
			const state = {
				playout: {
					slate: { onAir: true, effectiveStartedAt: 1_700_000_000_000, cut: false },
				},
				inputs: {},
				channels: { lower: 'slate' },
			};

			expect(broadcastGraphicsRecoveryFault(state)).toBeNull();
			// `channels` survives untouched, which is the point; `sources` is one of the
			// maps the reader indexes, so it is filled in rather than left absent.
			expect(recoveredBroadcastGraphicsLiveState(state)).toEqual({ ...state, sources: {} });
		});

		it('trusts a bounded correlated Social Profile Projection state across reload and restart', () => {
			const state = {
				playout: {},
				inputs: {},
				sources: {},
				socialProfileProjections: {
					lower: {
						profile: {
							talent: { id: 7, name: 'Ava Reed' },
							acceptedProfiles: [
								{
									network: 'twitch',
									networkLabel: 'Twitch',
									handle: 'AvaLive',
									profileUrl: 'https://www.twitch.tv/AvaLive',
								},
								{
									network: 'x',
									networkLabel: 'X',
									handle: 'AvaCasts',
									profileUrl: 'https://x.com/AvaCasts',
								},
							],
							currentNetwork: 'x',
							manualNetwork: 'x',
							automatic: true,
							rotationAnchor: { network: 'x', anchoredAt: 123_456 },
							updateFrom: [
								{
									values: {
										network: 'twitch',
										networkLabel: 'Twitch',
										handle: 'Before',
										profileUrl: 'https://www.twitch.tv/Before',
									},
									opacity: 0.5,
									offsetX: 0,
									offsetY: 0,
								},
							],
							pendingUpdateFrom: [],
						},
					},
				},
			};

			expect(broadcastGraphicsRecoveryFault(state)).toBeNull();
			expect(recoveredBroadcastGraphicsLiveState(JSON.parse(JSON.stringify(state)))).toEqual(state);
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
			expect(onAirBroadcastGraphicIds(recovered, [
				{ id: 'slate' },
				{ id: 'bug' },
			])).toEqual([]);
		});
	});

	describe('corrupt durable live state', () => {
		it.each([
			['a string', '{"playout":'],
			['a number', 7],
			[
				'an array',
				[
					{ onAir: true },
				],
			],
			[
				'a non-object playout map',
				{ playout: 'slate', inputs: {} },
			],
			[
				'a non-object inputs map',
				{ playout: {}, inputs: 3 },
			],
			[
				'a non-object playout record',
				{
					playout: { slate: true },
					inputs: {},
				},
			],
			[
				'a non-object inputs record',
				{
					playout: {},
					inputs: { slate: 'Ava' },
				},
			],
			[
				'a non-object working map',
				{
					playout: {},
					inputs: {
						slate: { working: 'Ava', accepted: {} },
					},
				},
			],
			[
				'a non-object Social Profile Projection map',
				{
					playout: {},
					inputs: {},
					socialProfileProjections: [],
				},
			],
			[
				'a non-object Social Profile Projection record',
				{
					playout: {},
					inputs: {},
					socialProfileProjections: {
						lower: { profile: null },
					},
				},
			],
			[
				'a non-array accepted Social Profile set',
				{
					playout: {},
					inputs: {},
					socialProfileProjections: {
						lower: {
							profile: { acceptedProfiles: {} },
						},
					},
				},
			],
		])('reports %s as corrupt', (_label, raw) => {
			expect(broadcastGraphicsRecoveryFault(raw)?.reason).toBe('corrupt');
		});

		it('names what could not be read, so the fault is diagnosable rather than just fatal', () => {
			const fault = broadcastGraphicsRecoveryFault({
				playout: { slate: true },
				inputs: {},
			});

			expect(fault?.detail).toMatch(/slate/);
		});

		it('recovers with nothing on air rather than with the part it could read', () => {
			// Half-trusting a corrupt state is the failure mode this exists to prevent:
			// program would show whichever graphics happened to survive parsing.
			const recovered = recoveredBroadcastGraphicsLiveState({
				playout: {
					good: { onAir: true },
					bad: 'yes',
				},
				inputs: {},
			});

			expect(onAirBroadcastGraphicIds(recovered, [
				{ id: 'good' },
				{ id: 'bad' },
			])).toEqual([]);
		});
	});

	describe('incompatible durable live state', () => {
		it.each([
			[
				'an on-air intent that is not a boolean',
				{
					playout: {
						slate: { onAir: 'yes' },
					},
					inputs: {},
				},
			],
			[
				'an acceptance revision that is not a number',
				{
					playout: {},
					inputs: {
						slate: { working: {}, accepted: {}, acceptedRevision: '4' },
					},
				},
			],
			[
				'a Cut modifier that is not a boolean',
				{
					playout: {
						slate: { onAir: true, effectiveStartedAt: 0, cut: 'yes' },
					},
					inputs: {},
				},
			],
			// Not a number at all, which is corruption rather than staleness: an old start
			// time settles at the Graphic Resting State by itself, while a non-numeric one
			// makes every phase comparison NaN-false and resolves a phase nobody predicted.
			[
				'an animation start time that is not a number',
				{
					playout: {
						slate: { onAir: true, effectiveStartedAt: 'soon', cut: false },
					},
					inputs: {},
				},
			],
			// A selection stores an entity id; anything else is a vocabulary this build cannot read.
			[
				'a Graphic Source Selection that does not name an entity',
				{
					playout: {},
					inputs: {},
					sources: {
						slate: { player: 'ava' },
					},
				},
			],
			[
				'a Graphic Source Selection that is empty rather than absent',
				{
					playout: {},
					inputs: {},
					sources: {
						slate: { player: null },
					},
				},
			],
			[
				'more accepted Social Profiles than the six-network catalog',
				withProfile({
					acceptedProfiles: Array.from({ length: 7 }).fill(avaTwitch),
				}),
			],
			[
				'a current Social Profile outside the accepted set',
				withProfile({
					acceptedProfiles: [
						avaTwitch,
					],
					currentNetwork: 'x',
				}),
			],
			[
				'a Social Profile tuple with a mismatched label',
				withProfile({
					acceptedProfiles: [
						{
							network: 'twitch',
							networkLabel: 'YouTube',
							handle: 'Ava',
							profileUrl: 'https://www.twitch.tv/Ava',
						},
					],
				}),
			],
			[
				'a Graphic Update Social Profile snapshot that is not canonical',
				withProfile({
					acceptedProfiles: [],
					updateFrom: [
						{
							values: {
								network: 'twitch',
								networkLabel: 'Not Twitch',
								handle: 'Ava',
								profileUrl: 'https://www.twitch.tv/Ava',
							},
							opacity: 1,
							offsetX: 0,
							offsetY: 0,
						},
					],
				}),
			],
			[
				'accepted Social Profiles outside catalog order',
				withProfile({
					acceptedProfiles: [
						{
							network: 'x',
							networkLabel: 'X',
							handle: 'AvaX',
							profileUrl: 'https://x.com/AvaX',
						},
						{
							network: 'twitch',
							networkLabel: 'Twitch',
							handle: 'AvaLive',
							profileUrl: 'https://www.twitch.tv/AvaLive',
						},
					],
				}),
			],
			[
				'accepted Social Profiles without their Talent identity',
				withProfile({
					acceptedProfiles: [
						{
							network: 'twitch',
							networkLabel: 'Twitch',
							handle: 'AvaLive',
							profileUrl: 'https://www.twitch.tv/AvaLive',
						},
					],
					currentNetwork: 'twitch',
				}),
			],
			[
				'a manual Social Profile without its Talent identity',
				withProfile({
					acceptedProfiles: [],
					manualNetwork: 'twitch',
				}),
			],
			[
				'an Automatic value that is not boolean',
				withProfile({
					talent: { id: 7, name: 'Ava' },
					acceptedProfiles: [
						avaTwitch,
					],
					currentNetwork: 'twitch',
					automatic: 'yes',
				}),
			],
			[
				'a rotation anchor outside the accepted set',
				withProfile({
					talent: { id: 7, name: 'Ava' },
					acceptedProfiles: [
						avaTwitch,
					],
					currentNetwork: 'twitch',
					automatic: true,
					rotationAnchor: { network: 'x', anchoredAt: 123_456 },
				}),
			],
			[
				'a rotation anchor instant that is not numeric',
				withProfile({
					talent: { id: 7, name: 'Ava' },
					acceptedProfiles: [
						avaTwitch,
					],
					currentNetwork: 'twitch',
					automatic: true,
					rotationAnchor: { network: 'twitch', anchoredAt: 'later' },
				}),
			],
			[
				'an unbounded interrupted Social Profile visual',
				withProfile({
					acceptedProfiles: [],
					transitionAnchor: {
						startedAt: 123_456,
						from: Array.from({ length: 13 }, (_, index) => ({
							values: {
								network: 'twitch',
								networkLabel: 'Twitch',
								handle: `Ava${index}`,
								profileUrl: `https://www.twitch.tv/Ava${index}`,
							},
							opacity: 1,
							offsetX: 0,
							offsetY: 0,
						})),
					},
				}),
			],
			[
				'an interrupted Social Profile tuple that is not canonical',
				withProfile({
					acceptedProfiles: [],
					transitionAnchor: {
						startedAt: 123_456,
						from: [
							{
								values: {
									network: 'twitch',
									networkLabel: 'Not Twitch',
									handle: 'Ava',
									profileUrl: 'https://www.twitch.tv/Ava',
								},
								opacity: 1,
								offsetX: 0,
								offsetY: 0,
							},
						],
					},
				}),
			],
			[
				'a duplicate correlated tuple in an interrupted Social Profile visual',
				withProfile({
					acceptedProfiles: [],
					transitionAnchor: {
						startedAt: 123_456,
						from: Array.from({ length: 2 }, () => ({
							values: avaTwitch,
							opacity: 1,
							offsetX: 0,
							offsetY: 0,
						})),
					},
				}),
			],
		])('reports %s as incompatible', (_label, raw) => {
			expect(broadcastGraphicsRecoveryFault(raw)?.reason).toBe('incompatible');
		});

		it('recovers with nothing on air', () => {
			const recovered = recoveredBroadcastGraphicsLiveState({
				playout: {
					slate: { onAir: 'yes' },
				},
				inputs: {},
			});

			expect(onAirBroadcastGraphicIds(recovered, [
				{ id: 'slate' },
			])).toEqual([]);
		});

		it('trusts a long-stale animation start time rather than calling it a fault', () => {
			// An old start time is read literally and settles itself, so it is not a fault.
			const ancient = {
				playout: {
					slate: { onAir: true, effectiveStartedAt: 1, cut: false },
				},
				inputs: {},
			};

			expect(broadcastGraphicsRecoveryFault(ancient)).toBeNull();
			expect(onAirBroadcastGraphicIds(recoveredBroadcastGraphicsLiveState(ancient), [
				{ id: 'slate' },
			]))
				.toEqual(['slate']);
		});

		it('accepts a bounded correlated Social Profile Transition anchor and legacy state without one', () => {
			const legacy = {
				playout: {},
				inputs: {},
				socialProfileProjections: {
					lower: {
						profile: { acceptedProfiles: [] },
					},
				},
			};
			const transitioning = {
				...legacy,
				socialProfileProjections: {
					lower: {
						profile: {
							acceptedProfiles: [],
							transitionAnchor: {
								startedAt: 123_456,
								from: [
									{
										values: avaTwitch,
										opacity: 0.5,
										offsetX: -50,
										offsetY: 0,
									},
								],
							},
						},
					},
				},
			};

			expect(broadcastGraphicsRecoveryFault(legacy)).toBeNull();
			expect(broadcastGraphicsRecoveryFault(transitioning)).toBeNull();
		});

		it('accepts distinct old and new correlated tuples on one catalog network', () => {
			const transitioning = {
				playout: {},
				inputs: {},
				socialProfileProjections: {
					lower: {
						profile: {
							acceptedProfiles: [],
							transitionAnchor: {
								startedAt: 123_456,
								from: ['OldAva', 'NewAva'].map(handle => ({
									values: {
										network: 'twitch',
										networkLabel: 'Twitch',
										handle,
										profileUrl: `https://www.twitch.tv/${handle}`,
									},
									opacity: 0.5,
									offsetX: 0,
									offsetY: 0,
								})),
							},
						},
					},
				},
			};

			expect(broadcastGraphicsRecoveryFault(transitioning)).toBeNull();
		});
	});

	describe('what survives ending one epoch and opening the next', () => {
		const ended = {
			playout: {
				slate: { onAir: true },
				bug: { onAir: true },
			},
			inputs: {
				slate: {
					working: { name: 'Ava' },
					accepted: { name: 'Ava' },
					acceptedRevision: 3,
				},
			},
		};

		it('carries prepared working values forward while turning every graphic off', () => {
			// A Screen leaving and re-entering Broadcast Graphics mode ends one epoch and
			// opens another. Nothing may still be on air across that boundary, but the
			// values an operator prepared for the next take are not a playout intent and
			// are exactly what they would otherwise have to retype mid-show.
			const next = carriedForwardBroadcastGraphicsLiveState(ended);

			expect(next.playout).toEqual({});
			expect(next.inputs.slate?.working).toEqual({ name: 'Ava' });
			expect(onAirBroadcastGraphicIds(next, [
				{ id: 'slate' },
				{ id: 'bug' },
			])).toEqual([]);
		});

		it('drops manual Social Profile Projection state at the epoch boundary', () => {
			const next = carriedForwardBroadcastGraphicsLiveState({
				...ended,
				socialProfileProjections: {
					lower: {
						profile: {
							acceptedProfiles: [
								avaTwitch,
							],
							currentNetwork: 'twitch',
							manualNetwork: 'twitch',
						},
					},
				},
			});

			expect(next.socialProfileProjections).toBeUndefined();
		});

		const endedWithBinding = {
			...ended,
			sources: {
				slate: { player: 7 },
			},
			inputs: {
				slate: {
					working: { name: 'Ava' },
					overrides: { name: 'Ava "Riptide" Reed' },
					accepted: { name: 'Ava' },
					acceptedRevision: 3,
				},
			},
		};

		it('carries a Graphic Source Selection forward, because every binding re-resolves it', () => {
			// A selection stores an entity id, so a binding reading it re-resolves from
			// current Event Data on every read: the operator sees which entity in the picker
			// it generated, and an entity that has gone makes the binding unavailable rather
			// than wrong. It is also the control that costs most to redo.
			const next = carriedForwardBroadcastGraphicsLiveState(endedWithBinding);

			expect(next.sources).toEqual({
				slate: { player: 7 },
			});
			expect(next.inputs.slate?.working).toEqual({ name: 'Ava' });
			// And still nothing on air, and still no acceptance.
			expect(next.playout).toEqual({});
			expect(next.inputs.slate?.acceptedRevision).toBe(0);
		});

		it('leaves a Graphic Input Override behind, because nothing can re-judge it', () => {
			// A carried override would outrank a correct binding in the next show.
			const next = carriedForwardBroadcastGraphicsLiveState(endedWithBinding);

			expect(next.inputs.slate?.overrides).toEqual({});
		});

		it('resumes the bound value in the new epoch rather than the previous show\'s correction', () => {
			// The hazard stated as the behaviour that replaces it: the new epoch's first
			// Take resolves the binding, and what reaches air is this show's value.
			const next = carriedForwardBroadcastGraphicsLiveState(endedWithBinding);
			const declaration: GraphicInputDeclaration = {
				type: 'text',
				key: 'name',
				label: 'Name',
				required: false,
				updatePolicy: 'staged',
				default: 'Unnamed',
				maxLength: 40,
			};
			const bindings = [
				{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' },
			];

			const taken = applyBroadcastGraphicsCommand(
				next,
				{
					type: 'Take',
					payload: { graphicId: 'slate' },
				},
				{
					inputs: [declaration],
					bindings,
					resolveBindings: () => ({ name: 'Sam Ortiz' }),
					acceptedAt: 1_700_000_000_000,
				},
			);

			expect(taken.inputs.slate?.accepted).toEqual({ name: 'Sam Ortiz' });
		});

		it('carries no accepted value or acceptance revision into the new epoch', () => {
			// Nothing is on air after the show, and a carried acceptance would let a required
			// unavailable input reach air.
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
				playout: {
					slate: { onAir: true },
				},
				inputs: {
					slate: {
						working: {
							name: 'A'.repeat(50),
						},
						accepted: { name: 'Ava' },
						acceptedRevision: 2,
					},
				},
			});

			// The settled rule, asserted through the gate itself rather than through the
			// shape: a required unavailable Graphic Input prevents a Take.
			expect(() => applyBroadcastGraphicsCommand(
				next,
				{
					type: 'Take',
					payload: { graphicId: 'slate' },
				},
				{
					inputs: [required],
					acceptedAt: 1_700_000_000_000,
				},
			)).toThrow(expect.objectContaining({ code: 'required-input-unavailable' }));
		});

		it('carries nothing forward from state it cannot trust', () => {
			expect(carriedForwardBroadcastGraphicsLiveState({
				playout: 'slate',
				inputs: { a: 1 },
			}))
				.toEqual(createInitialBroadcastGraphicsLiveState());
		});

		// Each call must assign into fresh factory state, or one graphic's or epoch's values leak
		// into another's (#348).
		it('gives every graphic and every epoch its own state to be assigned into', () => {
			const first = carriedForwardBroadcastGraphicsLiveState({
				inputs: {
					slate: {
						working: { name: 'Ava' },
					},
					bug: {
						working: { name: 'Sam' },
					},
				},
				sources: {
					slate: { player: 7 },
				},
			});
			const second = carriedForwardBroadcastGraphicsLiveState({ inputs: {} });

			// A shared factory fails the first assertion.
			expect(first.inputs.slate?.working).toEqual({ name: 'Ava' });
			expect(first.inputs.bug?.working).toEqual({ name: 'Sam' });
			expect(first.inputs.slate).not.toBe(first.inputs.bug);

			// Per epoch, read after the second state is built: if the live-state factory
			// returned a shared constant, building `second` would empty the selections
			// `first` carried.
			expect(first).not.toBe(second);
			expect(first.sources).toEqual({
				slate: { player: 7 },
			});
			expect(second.sources).toEqual({});
		});
	});
});
