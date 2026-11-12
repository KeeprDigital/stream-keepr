import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsCommandRefusal,
	graphicAssetRefusalOutcome,
} from '~~/app/utils/broadcastGraphicsCommandRefusal';

const MISSING_MESSAGE
	= 'Graphic Asset Reference at graphics.promo.items.sting.asset is missing, '
		+ 'so this Broadcast Graphic cannot be taken on air';

/**
 * One failed command: the parsed body is on `data`, the transport's line on `message`.
 * A plain object suits this pure reader; a store suite needs `test/helpers/transportFailure` (#241).
 */
function failedCommand(body: unknown) {
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

// The code decides which of two opposite next moves a surface prescribes; the sentence names the slot to repair.
describe('the domain refusal a failed Broadcast Graphics command carries', () => {
	it('reads the code and the sentence the authority wrote out of the response body', () => {
		const refusal = broadcastGraphicsCommandRefusal(
			failedCommand(refusalBody('missing-asset-reference', MISSING_MESSAGE)),
		);

		expect(refusal).toEqual({ code: 'missing-asset-reference', message: MISSING_MESSAGE });
	});

	it('tells the two Graphic Asset failures apart, because their next moves are opposite', () => {
		const unavailable = broadcastGraphicsCommandRefusal(failedCommand(refusalBody(
			'unavailable-asset-content',
			'Graphic Asset Content at graphics.promo.items.sting.asset is temporarily unavailable, '
			+ 'so this Broadcast Graphic cannot be taken on air',
		)));

		expect(unavailable?.code).toBe('unavailable-asset-content');
	});

	it('is nothing at all for a failure that carries no refusal', () => {
		// Treating an ended epoch as a refusal would suppress the reload it needs.
		expect(broadcastGraphicsCommandRefusal(new Error('Failed to fetch'))).toBeUndefined();
		expect(broadcastGraphicsCommandRefusal(failedCommand(undefined))).toBeUndefined();
		expect(broadcastGraphicsCommandRefusal(failedCommand({ statusCode: 409 }))).toBeUndefined();
		expect(broadcastGraphicsCommandRefusal(null)).toBeUndefined();
	});

	it('is nothing at all for a code outside the refusal vocabulary', () => {
		expect(broadcastGraphicsCommandRefusal(
			failedCommand(refusalBody('not-a-refusal-code', 'Something the client does not know')),
		)).toBeUndefined();
	});

	it('classifies the two Graphic Asset refusals once, for every surface that reports one', () => {
		expect(graphicAssetRefusalOutcome('missing-asset-reference')).toBe('missing');
		expect(graphicAssetRefusalOutcome('unavailable-asset-content')).toBe('unavailable');
	});

	it('classifies a refusal about the show as no Graphic Asset failure at all', () => {
		expect(graphicAssetRefusalOutcome('stale-input-edit')).toBeUndefined();
		expect(graphicAssetRefusalOutcome('required-input-unavailable')).toBeUndefined();
		expect(graphicAssetRefusalOutcome('update-unavailable')).toBeUndefined();
	});

	it('keeps the code when the sentence is missing, rather than losing both', () => {
		// The code alone still prescribes the next move.
		const refusal = broadcastGraphicsCommandRefusal(
			failedCommand({
				statusCode: 409,
				data: { code: 'missing-asset-reference' },
			}),
		);

		expect(refusal?.code).toBe('missing-asset-reference');
		expect(refusal?.message).toBeTruthy();
	});
});
