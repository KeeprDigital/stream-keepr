/**
 * Shared sequenced live-state module.
 *
 * One durable write protocol — sequencing, compare-and-swap, compact command
 * receipts, idempotent replay, merge retry, post-commit publication — behind
 * `load` and `execute`, reused by every live-state feature. See
 * `sequencedLiveState.ts` for the protocol and `receipts.ts` for the receipt
 * store it keeps.
 */
export type { CommandReceipt } from './receipts';
export {
	commandFingerprint,
	findCommandReceipt,
	RETAINED_COMMAND_RECEIPTS,
} from './receipts';
export type {
	SequencedCommand,
	SequencedLiveState,
	SequencedLiveStateCommitInput,
	SequencedLiveStateExecuteOptions,
	SequencedLiveStatePort,
} from './sequencedLiveState';
export { createSequencedLiveState } from './sequencedLiveState';
