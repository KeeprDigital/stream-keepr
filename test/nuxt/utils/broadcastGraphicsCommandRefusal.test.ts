import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsCommandRefusal,
	graphicAssetRefusalOutcome,
} from '~~/app/utils/broadcastGraphicsCommandRefusal';

const MISSING_MESSAGE
	= 'Graphic Asset Reference at graphics.promo.items.sting.asset is missing, '
		+ 'so this Broadcast Graphic cannot be taken on air';

/**
 * One refused command as `$fetch` hands it to a caller.
 *
 * `error.data` is the parsed response body, and the body a refusal arrives in is the
 * one the server writes for `createError({ message, data })` — so the domain code and
 * the domain sentence are both inside it, and `Error.message` is the transport's.
 */
function transportFailure(body: unknown) {
	return {
		statusCode: 409,
		message: `[POST] "/api/…/commands": 409 Conflict`,
		data: body,
	};
}

function refusalBody(code: string, message: string) {
	return {
		statusCode: 409,
		statusMessage: 'Conflict',
		message,
		data: { code, inputKeys: [] },
	};
}

/**
 * Reading a refused playout command for what it says rather than for how it failed.
 *
 * Both halves matter and they live in different places: the code decides which of two
 * opposite next moves a surface prescribes, and only the sentence names the owner slot
 * the operator has to go and repair.
 */
describe('the domain refusal a failed Broadcast Graphics command carries', () => {
	it('reads the code and the sentence the authority wrote out of the response body', () => {
		const refusal = broadcastGraphicsCommandRefusal(
			transportFailure(refusalBody('missing-asset-reference', MISSING_MESSAGE)),
		);

		expect(refusal).toEqual({ code: 'missing-asset-reference', message: MISSING_MESSAGE });
		// Not the transport's line, which is what `Error.message` would have given and
		// what an operator used to be shown instead (#230).
		expect(refusal?.message).not.toMatch(/409 Conflict/);
	});

	it('tells the two Graphic Asset failures apart, because their next moves are opposite', () => {
		const unavailable = broadcastGraphicsCommandRefusal(transportFailure(refusalBody(
			'unavailable-asset-content',
			'Graphic Asset Content at graphics.promo.items.sting.asset is temporarily unavailable, '
			+ 'so this Broadcast Graphic cannot be taken on air',
		)));

		expect(unavailable?.code).toBe('unavailable-asset-content');
	});

	it('is nothing at all for a failure that carries no refusal', () => {
		// A network fault, a 500, and an ended epoch all arrive here, and none of them is
		// the authority saying anything about the command — treating one as a refusal
		// would suppress the reload an ended epoch needs.
		expect(broadcastGraphicsCommandRefusal(new Error('Failed to fetch'))).toBeUndefined();
		expect(broadcastGraphicsCommandRefusal(transportFailure(undefined))).toBeUndefined();
		expect(broadcastGraphicsCommandRefusal(transportFailure({ statusCode: 409 }))).toBeUndefined();
		expect(broadcastGraphicsCommandRefusal(null)).toBeUndefined();
	});

	it('is nothing at all for a code outside the refusal vocabulary', () => {
		// The vocabulary is what a client is entitled to act on. A code it does not know
		// is a code whose next move it cannot name, so it is left to the fallback.
		expect(broadcastGraphicsCommandRefusal(
			transportFailure(refusalBody('vp9-alpha-chromium-required', 'Not playable on this target')),
		)).toBeUndefined();
	});

	it('classifies the two Graphic Asset refusals once, for every surface that reports one', () => {
		// Live Control's picker prose and the Live workspace's banner title are worded
		// differently on purpose, but *which* refusals are about an asset is one fact.
		// It was two, so a third asset code would have had to be added to both.
		expect(graphicAssetRefusalOutcome('missing-asset-reference')).toBe('missing');
		expect(graphicAssetRefusalOutcome('unavailable-asset-content')).toBe('unavailable');
	});

	it('classifies a refusal about the show as no Graphic Asset failure at all', () => {
		// Naming one of these as an asset failure would tell an operator to repair a
		// reference that is doing nothing wrong.
		expect(graphicAssetRefusalOutcome('stale-input-edit')).toBeUndefined();
		expect(graphicAssetRefusalOutcome('required-input-unavailable')).toBeUndefined();
		expect(graphicAssetRefusalOutcome('update-unavailable')).toBeUndefined();
	});

	it('keeps the code when the sentence is missing, rather than losing both', () => {
		// The code alone still tells a surface which of the two next moves to prescribe.
		// Dropping the refusal because its prose went missing would trade a vague message
		// for a wrong one — a refusal reported as a failure of the action.
		const refusal = broadcastGraphicsCommandRefusal(
			transportFailure({ statusCode: 409, data: { code: 'missing-asset-reference' } }),
		);

		expect(refusal?.code).toBe('missing-asset-reference');
		expect(refusal?.message).toBeTruthy();
	});
});
