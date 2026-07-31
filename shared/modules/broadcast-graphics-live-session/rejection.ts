/**
 * Why a Broadcast Graphics command was refused.
 *
 * These are domain refusals, not transport failures, so they are raised from the
 * shared reducer and mapped to a status code by whichever adapter carries the
 * command. Keeping them here is what lets a client predict the same refusal
 * before sending — Live Control can grey out an Update Graphic it knows would be
 * refused — from exactly the rule the server enforces.
 */
export const BROADCAST_GRAPHICS_REJECTION_CODES = [
	/** Update Graphic named an acceptance a newer one has superseded. */
	'stale-input-acceptance',
	/**
	 * A Set Input named a value another operator has already replaced.
	 *
	 * Field-scoped, and deliberately a different refusal from a stale acceptance:
	 * this one is about one Graphic Input's working value being overtaken, so it can
	 * be reported against that one field and recovered by refreshing it, while a
	 * stale acceptance is about the whole staged set going on air.
	 */
	'stale-input-edit',
	/** A required Graphic Input has no available value, so Take cannot proceed. */
	'required-input-unavailable',
	/** Update Graphic is offered only while a Broadcast Graphic is on air. */
	'update-unavailable',
	/** The command named a Graphic Input this Broadcast Graphic does not declare. */
	'unknown-input',
	/**
	 * The command named a Graphic Source Selection this Broadcast Graphic does not
	 * declare, or one no operator selects — the current Event and a derived selection
	 * both resolve without anyone picking them.
	 */
	'unknown-source',
	/**
	 * A Graphic Input Override was set on a Graphic Input with no Graphic Input
	 * Binding. An override exists to mask a binding; with no binding there is nothing
	 * to mask, and the working value is the one way to set such an input.
	 */
	'override-unbound',
] as const;

export type BroadcastGraphicsRejectionCode = typeof BROADCAST_GRAPHICS_REJECTION_CODES[number];

export class BroadcastGraphicsCommandRejection extends Error {
	readonly code: BroadcastGraphicsRejectionCode;
	/** The Graphic Inputs the refusal is about, when it is about particular ones. */
	readonly inputKeys: string[];

	constructor(code: BroadcastGraphicsRejectionCode, message: string, inputKeys: string[] = []) {
		super(message);
		this.name = 'BroadcastGraphicsCommandRejection';
		this.code = code;
		this.inputKeys = inputKeys;
	}
}
