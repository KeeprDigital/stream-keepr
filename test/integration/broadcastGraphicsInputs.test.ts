import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { GraphicInputDeclaration } from '~~/shared/types/graphics';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createGraphicsHarness,
	getBroadcastGraphicsLiveSession,
	integrationBroadcastGraphicWithInputs,
	integrationTextInput,
	playoutCommandId,
	setBroadcastGraphicInput,
} from './broadcastGraphicsPlayoutHelpers';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

/**
 * Graphic Inputs and Live Control, proven through the authoritative surface: one
 * command in, the authoritative snapshot out. Every rule an operator relies on —
 * what is staged, what is on air, what blocks a Take — is asserted as the snapshot
 * a second Live Control would load, never as an internal.
 */

const GRAPHIC = 'lower-third';

const NAME = integrationTextInput('name', { default: 'Unnamed' });

function graphicWith(inputs: GraphicInputDeclaration[]) {
	return [
		integrationBroadcastGraphicWithInputs(GRAPHIC, inputs),
	];
}

describe('broadcast graphics Graphic Input command API', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Integration Graphic Inputs Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('accepts a Broadcast Graphic declaring typed Graphic Inputs and a Graphic Text Template', async () => {
		const harness = await createGraphicsHarness(eventId, 'inputs-declare', graphicWith([
			NAME,
			integrationTextInput('title'),
			{
				type: 'number',
				key: 'score',
				label: 'Score',
				required: false,
				updatePolicy: 'live',
				default: 0,
				integer: true,
				min: 0,
			},
			{
				type: 'toggle',
				key: 'flag',
				label: 'Flag',
				required: false,
				updatePolicy: 'staged',
				default: false,
			},
			{
				type: 'choice',
				key: 'side',
				label: 'Side',
				required: false,
				updatePolicy: 'staged',
				default: 'left',
				options: [
					{ value: 'left', label: 'Left' },
					{ value: 'right', label: 'Right' },
				],
			},
			{
				type: 'color',
				key: 'accent',
				label: 'Accent',
				required: false,
				updatePolicy: 'staged',
				default: '#00d9ff',
			},
			{
				type: 'media',
				key: 'badge',
				label: 'Badge',
				required: false,
				updatePolicy: 'staged',
				default: null,
				mediaKind: 'image',
			},
		]));

		const screen = await $fetch<{ modeConfigs: Record<string, { graphics: Array<{ inputs?: unknown[] }> }> }>(
			`/api/events/${eventId}/screens/${harness.screen.id}`,
		);

		expect(screen.modeConfigs['broadcast-graphics']!.graphics[0]!.inputs).toHaveLength(7);
	});

	it('shares a server-accepted working edit with every other session immediately', async () => {
		const harness = await createGraphicsHarness(eventId, 'inputs-shared', graphicWith([NAME]));

		await setBroadcastGraphicInput(harness, GRAPHIC, 'name', 'Ava Reed');

		// A second Live Control has nothing but the authoritative snapshot to go on,
		// and it already carries the edit — nobody had to publish it.
		const elsewhere = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);

		expect(elsewhere.currentState.inputs[GRAPHIC]!.working).toEqual({ name: 'Ava Reed' });
		// And it is not on air, because the graphic is off and nothing has accepted it.
		expect(elsewhere.currentState.inputs[GRAPHIC]!.accepted).toEqual({});
	});

	it('keeps a staged edit off air until Update Graphic accepts the complete set', async () => {
		const harness = await createGraphicsHarness(eventId, 'inputs-update', graphicWith([
			NAME,
			integrationTextInput('title'),
		]));
		await harness.send({
			commandId: playoutCommandId('take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		await setBroadcastGraphicInput(harness, GRAPHIC, 'name', 'Ava Reed');
		const staged = await setBroadcastGraphicInput(harness, GRAPHIC, 'title', 'Champion');

		expect(staged.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Unnamed', title: '' });

		const updated = await harness.send({
			commandId: playoutCommandId('update'),
			type: 'Update Graphic',
			payload: {
				graphicId: GRAPHIC,
				basedOnAcceptedRevision: staged.currentState.inputs[GRAPHIC]!.acceptedRevision,
			},
		} as BroadcastGraphicsCommand);

		expect(updated.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava Reed', title: 'Champion' });
	});

	it('rejects an acceptance another operator has already superseded', async () => {
		const harness = await createGraphicsHarness(eventId, 'inputs-stale', graphicWith([NAME]));
		await harness.send({
			commandId: playoutCommandId('take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});
		const staged = await setBroadcastGraphicInput(harness, GRAPHIC, 'name', 'First');
		const revision = staged.currentState.inputs[GRAPHIC]!.acceptedRevision;

		await harness.send({
			commandId: playoutCommandId('update-first'),
			type: 'Update Graphic',
			payload: { graphicId: GRAPHIC, basedOnAcceptedRevision: revision },
		} as BroadcastGraphicsCommand);
		await setBroadcastGraphicInput(harness, GRAPHIC, 'name', 'Second');

		// A colleague whose Live Control had not caught up still names the acceptance
		// it saw. The guard refuses it rather than overwriting the acceptance it
		// never knew about.
		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: playoutCommandId('update-stale'),
					type: 'Update Graphic',
					payload: { graphicId: GRAPHIC, basedOnAcceptedRevision: revision },
				},
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(409);
		expect(res._data?.message).toMatch(/newer Graphic Input set/i);

		const unchanged = await getBroadcastGraphicsLiveSession(eventId, harness.screen.id);
		expect(unchanged.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'First' });
	});

	it('stores a value that violates its declared bound rather than coercing it, and never accepts it', async () => {
		const harness = await createGraphicsHarness(eventId, 'inputs-unavailable', graphicWith([NAME]));
		await harness.send({
			commandId: playoutCommandId('take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});
		const good = await setBroadcastGraphicInput(harness, GRAPHIC, 'name', 'Ava Reed');
		await harness.send({
			commandId: playoutCommandId('update-good'),
			type: 'Update Graphic',
			payload: {
				graphicId: GRAPHIC,
				basedOnAcceptedRevision: good.currentState.inputs[GRAPHIC]!.acceptedRevision,
			},
		} as BroadcastGraphicsCommand);

		const tooLong = 'A'.repeat(50);
		const staged = await setBroadcastGraphicInput(harness, GRAPHIC, 'name', tooLong);

		// Stored exactly as entered, so Live Control can show what is wrong with it.
		expect(staged.currentState.inputs[GRAPHIC]!.working).toEqual({ name: tooLong });

		const updated = await harness.send({
			commandId: playoutCommandId('update-unavailable'),
			type: 'Update Graphic',
			payload: {
				graphicId: GRAPHIC,
				basedOnAcceptedRevision: staged.currentState.inputs[GRAPHIC]!.acceptedRevision,
			},
		} as BroadcastGraphicsCommand);

		// And on air the last accepted rendering is still what program shows.
		expect(updated.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava Reed' });
	});

	it('rejects an edit naming a Graphic Input the Broadcast Graphic does not declare', async () => {
		const harness = await createGraphicsHarness(eventId, 'inputs-unknown', graphicWith([NAME]));

		const res = await $fetchRaw(
			`/api/events/${eventId}/screens/${harness.screen.id}/broadcast-graphics/live-sessions/${harness.session().id}/commands`,
			{
				method: 'POST',
				body: {
					commandId: playoutCommandId('unknown-input'),
					type: 'Set Input',
					payload: { graphicId: GRAPHIC, inputKey: 'ghost', value: 'x' },
				},
				ignoreResponseError: true,
			},
		);

		expect(res.status).toBe(404);
	});

	it('survives reload with its accepted values, settled rather than replayed', async () => {
		const harness = await createGraphicsHarness(eventId, 'inputs-durable', graphicWith([NAME]));
		await setBroadcastGraphicInput(harness, GRAPHIC, 'name', 'Ava Reed');
		await harness.send({
			commandId: playoutCommandId('take'),
			type: 'Take',
			payload: { graphicId: GRAPHIC },
		});

		const reloaded = await harness.reload();

		expect(reloaded.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Ava Reed' });
		expect(reloaded.currentState.playout[GRAPHIC]).toMatchObject({ onAir: true, cut: false });
	});
});
