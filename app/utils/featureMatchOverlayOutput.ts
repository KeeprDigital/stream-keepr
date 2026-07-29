import type { FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { parseScreenOutput, SCREEN_OUTPUT_VALUES, screenOutputBackground } from '~~/shared/utils/screenOutput';

export const FEATURE_MATCH_OVERLAY_OUTPUTS: FeatureMatchOverlayOutput[] = SCREEN_OUTPUT_VALUES;

export const parseFeatureMatchOverlayOutput = parseScreenOutput;

export const featureMatchOverlayOutputBackground = screenOutputBackground;
