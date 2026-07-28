import type {
	GraphicAssetValidationIssue,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';
import { STILL_IMAGE_COMPATIBILITY_PROFILE } from '~~/shared/utils/graphicsAssetCompatibility';

export class GraphicAssetValidationError extends Error {
	readonly issue: GraphicAssetValidationIssue;

	constructor(readonly issues: readonly GraphicAssetValidationIssue[]) {
		if (issues.length === 0)
			throw new Error('Graphic Asset validation errors require at least one issue');
		super(issues.map(issue => issue.message).join(' '));
		this.issue = issues[0]!;
	}
}

export function validationIssue(
	code: GraphicAssetValidationIssue['code'],
	message: string,
): GraphicAssetValidationIssue {
	return { severity: 'error', code, message };
}

export function validationError(
	code: GraphicAssetValidationIssue['code'],
	message: string,
): never {
	throw new GraphicAssetValidationError([validationIssue(code, message)]);
}

export function rejectedValidationReport(
	error: GraphicAssetValidationError,
): GraphicAssetValidationReport {
	return {
		outcome: 'rejected',
		compatibilityProfile: STILL_IMAGE_COMPATIBILITY_PROFILE,
		issues: [...error.issues],
	};
}
