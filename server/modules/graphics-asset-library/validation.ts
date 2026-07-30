import type {
	GraphicAssetValidationIssue,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';
import type {
	SILENT_VIDEO_COMPATIBILITY_PROFILE,
	STATIC_FONT_COMPATIBILITY_PROFILE,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { STILL_IMAGE_COMPATIBILITY_PROFILE as STILL_IMAGE_PROFILE } from '~~/shared/utils/graphicsAssetCompatibility';

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
	profile: typeof STILL_IMAGE_COMPATIBILITY_PROFILE | typeof SILENT_VIDEO_COMPATIBILITY_PROFILE | typeof STATIC_FONT_COMPATIBILITY_PROFILE
		= STILL_IMAGE_PROFILE,
): GraphicAssetValidationReport {
	return {
		outcome: 'rejected',
		compatibilityProfile: profile,
		issues: [...error.issues],
	};
}
