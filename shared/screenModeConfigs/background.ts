import type { BackgroundLayer } from '../types/screenConfig';
import type { ScreenModeConfigOf } from './contract';
import { defineScreenModeConfigContract, serverValidatedField } from './contract';

/**
 * The Background Screen Mode's config contract: an ordered stack of Background
 * Layers, replacing the former Idle mode's single optional media background. The
 * old `mediaBackground` config resets rather than mapping onto a layer, the
 * ADR-0014 reset precedent, accepted for the same small install base.
 *
 * The stack's schema reaches server-only Graphic Asset ids, so the server
 * supplies it, as it does for every declaring mode's own `backgroundLayers`. A
 * fresh Background Screen starts empty, black until configured.
 */
export const backgroundModeConfigContract = defineScreenModeConfigContract({
	layers: serverValidatedField<BackgroundLayer[]>(),
}, {
	layers: [],
}, {
	authoredStacks: ['layers'],
});

export type BackgroundModeConfig = ScreenModeConfigOf<typeof backgroundModeConfigContract>;
