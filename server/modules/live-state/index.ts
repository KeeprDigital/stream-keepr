/**
 * Shared sequenced live-state module.
 *
 * One durable write protocol — sequencing, compare-and-swap, compact command
 * receipts, idempotent replay, merge retry, post-commit publication — behind
 * `load` and `execute`, reused by every live-state feature, and one epoch
 * lifecycle — open, close, forget receipts, announce — behind
 * `createSequencedLiveEpochs`. See `sequencedLiveState.ts` for the protocol,
 * `epochs.ts` for the lifecycle, and `receipts.ts` for the receipt store both
 * keep.
 */
export type {
	SequencedLiveEpochChange,
	SequencedLiveEpochPort,
	SequencedLiveEpochs,
	SequencedLiveEpochSettleOptions,
	SequencedLiveEpochTransition,
} from './epochs';
export { createSequencedLiveEpochs } from './epochs';
export type { CommandReceipt } from './receipts';
export { commandContentKey } from './receipts';
export type {
	SequencedCommand,
	SequencedLiveState,
	SequencedLiveStateExecuteOptions,
	SequencedLiveStatePort,
	SequencedLiveStateProjectionInput,
	SequencedLiveStatePublication,
} from './sequencedLiveState';
export { createSequencedLiveState } from './sequencedLiveState';
