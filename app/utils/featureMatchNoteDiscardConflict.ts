import type { FeatureMatchNoteDiscardConflict } from '~~/shared/api';
import { isPlainRecord } from '~~/shared/utils/plainObject';
import { failureStatus } from '~/utils/failureStatus';

export function featureMatchNoteDiscardConflict(caught: unknown): FeatureMatchNoteDiscardConflict | null {
	if (failureStatus(caught) !== 409 || !isPlainRecord(caught))
		return null;
	const body = caught.data;
	if (!isPlainRecord(body) || !isPlainRecord(body.data))
		return null;
	const conflict = body.data;
	if (conflict.code !== 'feature-match-note-discard-required' || !Array.isArray(conflict.assignments))
		return null;
	return conflict as unknown as FeatureMatchNoteDiscardConflict;
}
