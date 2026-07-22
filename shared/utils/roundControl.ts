import type { ExternalSource, RoundControlMode } from '../types/enums';

interface RoundControlShape {
	externalSource?: ExternalSource | null;
	externalId?: string | null;
	controlMode?: RoundControlMode | null;
}

export function isManualOverrideRound(round: RoundControlShape | null | undefined) {
	return round?.controlMode === 'manual_override';
}

export function isMeleeManagedRound(round: RoundControlShape | null | undefined) {
	if (!round || isManualOverrideRound(round)) {
		return false;
	}

	return round.externalSource === 'melee' && !!round.externalId;
}

export function isManualResultsRound(round: RoundControlShape | null | undefined) {
	return !isMeleeManagedRound(round);
}
