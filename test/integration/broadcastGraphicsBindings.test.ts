import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { GraphicInputDeclaration, GraphicSourceSelectionDeclaration } from '~~/shared/types/graphics';
import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createGraphicsHarness,
	getBroadcastGraphicsLiveSession,
	integrationBroadcastGraphicWithBindings,
	integrationTextInput,
	playoutCommandId,
	selectBroadcastGraphicSource,
	setBroadcastGraphicOverride,
} from './broadcastGraphicsPlayoutHelpers';
import { $fetchRaw } from './helpers';

/**
 * Event Data binding, proven through the authoritative surface: one command in, the
 * authoritative snapshot out.
 *
 * The lower third an operator actually builds is the subject — they pick a Player
 * once, every bound field resolves, an override corrects one value without losing
 * the feed, and nothing that cannot resolve is allowed to reach program wearing the
 * template's own default.
 */

const GRAPHIC = 'lower-third';

const NAME = integrationTextInput('name', { default: 'Unnamed', maxLength: 40 });
const REQUIRED_NAME = integrationTextInput('name', { required: true, maxLength: 40 });
const LIVE_NAME = integrationTextInput('name', { updatePolicy: 'live', maxLength: 40 });
const RECORD = integrationTextInput('title', { maxLength: 40 });

const PLAYER_SOURCE = { key: 'player', label: 'Player', kind: 'player' as const };
const EVENT_SOURCE = { key: 'event', label: 'Current Event', kind: 'event' as const };
const NAME_BINDING = { inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' };
const RECORD_BINDING = { inputKey: 'title', sourceKey: 'player', fieldId: 'player.record' };

function graphicWith(
	inputs: GraphicInputDeclaration[],
	sources: GraphicSourceSelectionDeclaration[] = [PLAYER_SOURCE],
	bindings = [NAME_BINDING],
) {
	return [integrationBroadcastGraphicWithBindings(GRAPHIC, inputs, sources, bindings)];
}

describe('broadcast graphics Event Data binding API', () => {
	let eventId: number;
	let avaId: number;
	let samId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Graphic Binding Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		const ava = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Ava Reed', wins: 4, losses: 1, draws: 0 },
		});
		avaId = ava.id;
		const sam = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Sam Ortiz', wins: 3, losses: 2, draws: 0 },
		});
		samId = sam.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('takes the bound value on air once the operator picks a Player', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-take', graphicWith(
			[NAME, RECORD],
			[PLAYER_SOURCE],
			[NAME_BINDING, RECORD_BINDING],
		));

		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		const taken = await harness.send({
			commandId: playoutCommandId('bind-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		// One selection, two resolved fields — including the broadcast-formatted record,
		// which is composed here rather than in the Graphic Text Template.
		expect(taken.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava Reed', title: '4-1' });
	});

	it('never puts the template default on air for a binding that resolves nothing', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-no-fallback', graphicWith([NAME]));

		const taken = await harness.send({
			commandId: playoutCommandId('bind-no-select'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		expect(taken.currentState.inputs[GRAPHIC]!.accepted).toEqual({});
	});

	it('blocks Take while a required binding resolves nothing, and explains it', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-required', graphicWith([REQUIRED_NAME]));

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: { commandId: playoutCommandId('bind-blocked'), type: 'Take', payload: { graphicId: GRAPHIC } },
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(409);
		expect(res._data?.message).toMatch(/must have a value/i);

		const stillOff = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
		expect(stillOff.currentState.playout[GRAPHIC]).toBeUndefined();
	});

	it('holds a staged bound change until Update Graphic accepts it', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-staged', graphicWith([NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		await harness.send({ commandId: playoutCommandId('bind-take2'), type: 'Take', payload: { graphicId: GRAPHIC } });

		const reselected = await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', samId);

		expect(reselected.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava Reed' });

		const updated = await harness.send({
			commandId: playoutCommandId('bind-update'),
			type: 'Update Graphic',
			payload: {
				graphicId: GRAPHIC,
				basedOnAcceptedRevision: reselected.currentState.inputs[GRAPHIC]!.acceptedRevision,
			},
		} as BroadcastGraphicsCommand);

		expect(updated.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Sam Ortiz' });
	});

	it('applies a live-policy bound change the moment the selection changes', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-live', graphicWith([LIVE_NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		await harness.send({ commandId: playoutCommandId('bind-take3'), type: 'Take', payload: { graphicId: GRAPHIC } });

		const reselected = await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', samId);

		expect(reselected.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Sam Ortiz' });
	});

	it('holds the last accepted value on air when the selection is cleared', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-stale', graphicWith([REQUIRED_NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		await harness.send({ commandId: playoutCommandId('bind-take4'), type: 'Take', payload: { graphicId: GRAPHIC } });

		const cleared = await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', null);

		expect(cleared.currentState.sources![GRAPHIC]).toEqual({});
		// Program keeps what it committed to, rather than blanking a required field.
		expect(cleared.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava Reed' });
	});

	it('refuses to take a graphic again once a required binding has stopped resolving', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-retake-blocked', graphicWith([REQUIRED_NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		await harness.send({ commandId: playoutCommandId('bind-take8'), type: 'Take', payload: { graphicId: GRAPHIC } });
		await harness.send({ commandId: playoutCommandId('bind-out2'), type: 'Out', payload: { graphicId: GRAPHIC } });
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', null);

		// It was legitimately on air with Ava Reed, and that value is still stored. Taking
		// it again would put a name nobody has selected back on program with no warning,
		// so the off-air rule applies and the Take is refused.
		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: { commandId: playoutCommandId('bind-retake'), type: 'Take', payload: { graphicId: GRAPHIC } },
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(409);
		expect(res._data?.message).toMatch(/must have a value/i);

		const stillOff = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
		expect(stillOff.currentState.playout[GRAPHIC]).toMatchObject({ onAir: false });
	});

	it('refuses an override on a Graphic Input with no binding to mask', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-override-unbound', graphicWith([NAME], [PLAYER_SOURCE], []));

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: playoutCommandId('bind-override-unbound'),
					type: 'Set Override',
					payload: { graphicId: GRAPHIC, inputKey: 'name', value: 'Ava Reed' },
				},
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(409);
		expect(res._data?.message).toMatch(/no Graphic Input Binding to override/i);
	});

	it('masks a binding with an override and resumes the current bound value when cleared', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-override', graphicWith([LIVE_NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		await harness.send({ commandId: playoutCommandId('bind-take5'), type: 'Take', payload: { graphicId: GRAPHIC } });

		const overridden = await setBroadcastGraphicOverride(harness, GRAPHIC, 'name', 'Ava "Riptide" Reed');

		expect(overridden.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava "Riptide" Reed' });
		expect(overridden.currentState.inputs[GRAPHIC]!.overrides).toEqual({ name: 'Ava "Riptide" Reed' });

		// The binding kept resolving underneath, so clearing resumes what it resolves
		// now rather than what it resolved when the override was set.
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', samId);
		const resumed = await setBroadcastGraphicOverride(harness, GRAPHIC, 'name', null);

		expect(resumed.currentState.inputs[GRAPHIC]!.overrides).toEqual({});
		expect(resumed.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Sam Ortiz' });
	});

	it('keeps an override across a hide and show cycle', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-override-persists', graphicWith([NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		await setBroadcastGraphicOverride(harness, GRAPHIC, 'name', 'Ava "Riptide" Reed');
		await harness.send({ commandId: playoutCommandId('bind-take6'), type: 'Take', payload: { graphicId: GRAPHIC } });
		await harness.send({ commandId: playoutCommandId('bind-out'), type: 'Out', payload: { graphicId: GRAPHIC } });
		const retaken = await harness.send({
			commandId: playoutCommandId('bind-retake'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		expect(retaken.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava "Riptide" Reed' });
	});

	it('survives reload with its selections and overrides', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-durable', graphicWith([NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', avaId);
		await setBroadcastGraphicOverride(harness, GRAPHIC, 'name', 'Ava "Riptide" Reed');

		const reloaded = await harness.reload();

		expect(reloaded.currentState.sources![GRAPHIC]).toEqual({ player: avaId });
		expect(reloaded.currentState.inputs[GRAPHIC]!.overrides).toEqual({ name: 'Ava "Riptide" Reed' });
	});

	it('re-resolves a live-policy binding on air after the Event Data behind it changes', async () => {
		const renamed = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Rae Okonjo', wins: 2, losses: 0, draws: 0 },
		});
		const harness = await createGraphicsHarness(eventId, 'bind-reresolve', graphicWith([LIVE_NAME]));
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', renamed.id);
		await harness.send({ commandId: playoutCommandId('bind-take7'), type: 'Take', payload: { graphicId: GRAPHIC } });

		await $fetch(`/api/events/${eventId}/players/${renamed.id}`, {
			method: 'PATCH',
			body: { name: 'Rae Okonjo-Bell' },
		});

		// Nobody edited the graphic. The Realtime Event Session told Live Control the
		// Player moved, and the server re-resolved the binding for itself.
		const resolved = await harness.send({
			commandId: playoutCommandId('bind-reresolve'),
			type: 'Resolve Bindings',
			payload: { graphicId: GRAPHIC },
		} as BroadcastGraphicsCommand);

		expect(resolved.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Rae Okonjo-Bell' });
	});

	it('rejects a selection the Broadcast Graphic does not declare', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-unknown-source', graphicWith([NAME]));

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: playoutCommandId('bind-ghost-source'),
					type: 'Select Source',
					payload: { graphicId: GRAPHIC, sourceKey: 'ghost', selectionId: 1 },
				},
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(404);
	});

	it('resolves a Player derived from a Match out of that Match\'s production snapshot', async () => {
		const phase = await $fetch<{ id: number }>(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: { name: 'Swiss' },
		});
		const round = await $fetch<{ id: number }>(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: { phaseId: phase.id, name: 'Round 5', roundNumber: 5 },
		});
		const match = await $fetch<{ id: number }>(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId: round.id,
				tableNumber: 12,
				player1Id: avaId,
				player2Id: samId,
				player1Data: { name: 'Ava R.', wins: 4, losses: 1, draws: 0 },
				player2Data: { name: 'Sam O.', wins: 3, losses: 2, draws: 0 },
			},
		});

		const harness = await createGraphicsHarness(eventId, 'bind-derived', graphicWith(
			[NAME, RECORD],
			[
				{ key: 'match', label: 'Match', kind: 'match' },
				{ key: 'p1', label: 'Player 1', kind: 'player', from: { sourceKey: 'match', relation: 'player1' } },
			],
			[
				{ inputKey: 'name', sourceKey: 'p1', fieldId: 'player.name' },
				{ inputKey: 'title', sourceKey: 'match', fieldId: 'match.tableLabel' },
			],
		));

		await selectBroadcastGraphicSource(harness, GRAPHIC, 'match', match.id);
		const taken = await harness.send({
			commandId: playoutCommandId('bind-derived-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		// The Match's snapshot said "Ava R." while the live Event Player is "Ava Reed":
		// production committed to the snapshot, so that is what goes on air.
		expect(taken.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava R.', title: 'Table 12' });
	});

	it('refuses a Screen whose binding names a field the catalog does not define', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Broadcast Graphics bind-bad-field',
				slug: 'bind-bad-field',
				currentMode: 'broadcast-graphics',
				modeConfigs: {
					'broadcast-graphics': {
						graphics: graphicWith([NAME], [PLAYER_SOURCE], [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.inventedField' }]),
					},
				},
			},
			ignoreResponseError: true,
		});

		expect(res.status).toBe(400);
	});

	it('refuses a Screen whose derived selection follows a relationship that cannot yield its kind', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Broadcast Graphics bind-bad-derivation',
				slug: 'bind-bad-derivation',
				currentMode: 'broadcast-graphics',
				modeConfigs: {
					'broadcast-graphics': {
						graphics: graphicWith(
							[NAME],
							[
								PLAYER_SOURCE,
								// A Player has no `player1`: nothing an operator could ever fix.
								{ key: 'p1', label: 'Player 1', kind: 'player', from: { sourceKey: 'player', relation: 'player1' } },
							],
							[NAME_BINDING],
						),
					},
				},
			},
			ignoreResponseError: true,
		});

		expect(res.status).toBe(400);
	});
});

/**
 * Re-resolution with nobody watching.
 *
 * The live On-air Update Policy exists for the hands-free case: a lower third that
 * updates itself while the operator is looking at a different graphic, or at no
 * graphic at all. Every command here is an ordinary Event Data write — a Player
 * being renamed — and nothing addresses the Live Session, so what these prove is
 * that the authoritative side re-resolves for itself rather than because a browser
 * happened to be pointed at the right graphic.
 */
describe('broadcast graphics re-resolution driven by Event Data', () => {
	let eventId: number;

	async function createPlayer(name: string): Promise<number> {
		const player = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name, wins: 1, losses: 0, draws: 0 },
		});
		return player.id;
	}

	async function rename(playerId: number, name: string): Promise<void> {
		await $fetch(`/api/events/${eventId}/players/${playerId}`, { method: 'PATCH', body: { name } });
	}

	/** One placed Broadcast Graphic whose name is bound to its own Player selection. */
	function boundGraphic(id: string, inputs: GraphicInputDeclaration[]) {
		return integrationBroadcastGraphicWithBindings(
			id,
			inputs,
			[PLAYER_SOURCE],
			[{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
		);
	}

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Graphic Re-resolve Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('re-resolves every on-air live-policy graphic, not one an operator has selected', async () => {
		const first = await createPlayer('Nia Fontaine');
		const second = await createPlayer('Theo Vasquez');
		const harness = await createGraphicsHarness(eventId, 're-resolve-many', [
			boundGraphic('lead', [LIVE_NAME]),
			boundGraphic('second', [LIVE_NAME]),
		]);

		await selectBroadcastGraphicSource(harness, 'lead', 'player', first);
		await selectBroadcastGraphicSource(harness, 'second', 'player', second);
		await harness.send({ commandId: playoutCommandId('rr-take-lead'), type: 'Take', payload: { graphicId: 'lead' } });
		await harness.send({ commandId: playoutCommandId('rr-take-second'), type: 'Take', payload: { graphicId: 'second' } });

		await rename(first, 'Nia Fontaine-Cole');
		await rename(second, 'Theo Vasquez Jr');

		// No Live Control is open on this Screen, no client is connected to it, and no
		// command has addressed either graphic. Both lower thirds still say the new names.
		const reloaded = await harness.reload();

		expect(reloaded.currentState.inputs.lead!.accepted).toEqual({ name: 'Nia Fontaine-Cole' });
		expect(reloaded.currentState.inputs.second!.accepted).toEqual({ name: 'Theo Vasquez Jr' });
	});

	it('leaves a staged Graphic Input pending rather than putting it on air', async () => {
		const playerId = await createPlayer('Odile Brandt');
		const harness = await createGraphicsHarness(eventId, 're-resolve-staged', [boundGraphic('lead', [NAME])]);

		await selectBroadcastGraphicSource(harness, 'lead', 'player', playerId);
		await harness.send({ commandId: playoutCommandId('rr-take-staged'), type: 'Take', payload: { graphicId: 'lead' } });

		await rename(playerId, 'Odile Brandt-Reyes');
		const reloaded = await harness.reload();

		// A staged On-air Update Policy means an operator confirms it, and re-resolution
		// is not that confirmation.
		expect(reloaded.currentState.inputs.lead!.accepted).toEqual({ name: 'Odile Brandt' });
	});

	it('never overwrites a Graphic Input Override with a re-resolved value', async () => {
		const playerId = await createPlayer('Priya Raghunathan');
		const harness = await createGraphicsHarness(eventId, 're-resolve-override', [boundGraphic('lead', [LIVE_NAME])]);

		await selectBroadcastGraphicSource(harness, 'lead', 'player', playerId);
		await harness.send({ commandId: playoutCommandId('rr-take-override'), type: 'Take', payload: { graphicId: 'lead' } });
		await setBroadcastGraphicOverride(harness, 'lead', 'name', 'Priya R.');

		await rename(playerId, 'Priya Raghunathan-Singh');
		const reloaded = await harness.reload();

		// The binding kept resolving underneath; the operator's correction is what is on
		// air until they clear it.
		expect(reloaded.currentState.inputs.lead!.accepted).toEqual({ name: 'Priya R.' });
	});

	it('changes nothing about a Broadcast Graphic that is off air', async () => {
		const playerId = await createPlayer('Wendell Achebe');
		const harness = await createGraphicsHarness(eventId, 're-resolve-off', [boundGraphic('lead', [LIVE_NAME])]);

		await selectBroadcastGraphicSource(harness, 'lead', 'player', playerId);

		await rename(playerId, 'Wendell Achebe-Stone');
		const reloaded = await harness.reload();

		// Nothing has been accepted, because nothing is on program to accept into. The
		// graphic's next Take composes its values afresh from the current Event Data.
		expect(reloaded.currentState.inputs.lead?.accepted ?? {}).toEqual({});

		const taken = await harness.send({
			commandId: playoutCommandId('rr-take-off'),
			type: 'Take',
			payload: { graphicId: 'lead' },
		});
		expect(taken.currentState.inputs.lead!.accepted).toEqual({ name: 'Wendell Achebe-Stone' });
	});
});

/**
 * What the Event supplies that no operator picks.
 *
 * A Current Event Graphic Source Selection has nothing for an operator to pick — it
 * resolves the Event the Screen belongs to — and an Event's Talent is reached from it
 * by a fixed relationship rather than by a second pick. So a lower third naming the
 * Event and its Talent is fully resolved before anybody has touched a picker, which is
 * the case every selection-shaped test above skips over. The Event's game belongs here
 * for the same reason: it is what decides whether a game-specific field is offered at
 * all, and it arrives with the Event rather than with a selection.
 */
describe('broadcast graphics binding to the Event, its Talents, and its game', () => {
	let eventId: number;
	let talent1Id: number;
	let pickedTalentId: number;
	let deckPlayerId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Graphic Talent Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		// Three Talents, in this order so that neither Talent test below can pass by
		// reading whichever Talent the Event happens to list first: nothing names or picks
		// the one created first, the Event names the second as its Talent 1, and the
		// operator picks the third.
		await $fetch(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Rhys Delacroix' },
		});
		const named = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Imani Okoye' },
		});
		talent1Id = named.id;
		const picked = await $fetch<{ id: number }>(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Noor Haddad' },
		});
		pickedTalentId = picked.id;

		// `commentator1TalentId` is the stored name; an author reads it as Talent 1
		// (bindingResolution.ts's GRAPHIC_SOURCE_RELATION_LABELS).
		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { commentator1TalentId: talent1Id },
		});

		const player = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: {
				name: 'Dara Whitlock',
				wins: 5,
				losses: 0,
				draws: 0,
				gameData: { type: 'mtg', deckName: 'Boros Energy' },
			},
		});
		deckPlayerId = player.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('takes the Event\'s own name on air with no selection to make', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-event-kind', graphicWith(
			[NAME],
			[EVENT_SOURCE],
			[{ inputKey: 'name', sourceKey: 'event', fieldId: 'event.name' }],
		));

		const taken = await harness.send({
			commandId: playoutCommandId('bind-event-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		expect(taken.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Integration Graphic Talent Event' });
	});

	it('follows the Event to the Talent it names as Talent 1', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-talent-1', graphicWith(
			[NAME],
			[
				EVENT_SOURCE,
				{ key: 'talent1', label: 'Talent 1', kind: 'talent', from: { sourceKey: 'event', relation: 'commentator1' } },
			],
			[{ inputKey: 'name', sourceKey: 'talent1', fieldId: 'talent.name' }],
		));

		const taken = await harness.send({
			commandId: playoutCommandId('bind-talent-1-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		// The one the Event names as its Talent 1. The Event's other two Talents are not
		// reachable from here at all, and neither of them is the one it lists first.
		expect(taken.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Imani Okoye' });
	});

	it('resolves a Talent the operator picks for themselves', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-talent-kind', graphicWith(
			[NAME],
			[{ key: 'talent', label: 'Talent', kind: 'talent' }],
			[{ inputKey: 'name', sourceKey: 'talent', fieldId: 'talent.name' }],
		));

		// Neither the Talent the Event names as Talent 1 nor the one it lists first, so
		// this can only pass by reading the pick.
		await selectBroadcastGraphicSource(harness, GRAPHIC, 'talent', pickedTalentId);
		const taken = await harness.send({
			commandId: playoutCommandId('bind-talent-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		expect(taken.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Noor Haddad' });
	});

	it('resolves a Magic-only Player field on a Magic Event', async () => {
		const harness = await createGraphicsHarness(eventId, 'bind-game-specific', graphicWith(
			[NAME, RECORD],
			[PLAYER_SOURCE],
			[
				{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.deckName' },
				RECORD_BINDING,
			],
		));

		await selectBroadcastGraphicSource(harness, GRAPHIC, 'player', deckPlayerId);
		const taken = await harness.send({
			commandId: playoutCommandId('bind-game-specific-take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		// `player.deckName` carries `game: 'mtg'`, so resolution has to know this Event's
		// game before it will offer the field. The record beside it names no game, which is
		// what makes a data set that has lost the Event read as one field disappearing
		// rather than as the whole set failing to load. That the field is *withheld* on a
		// One Piece Event is held by the unit suite, which can build that Event in a line
		// (test/unit/shared/graphicBindingResolution.test.ts).
		expect(taken.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Boros Energy', title: '5-0' });
	});
});
