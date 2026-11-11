/**
 * The row motion Standings and Metagame share: how a row enters, leaves back
 * to, and moves, each row an eighth of the duration after the one above. It
 * takes its pace from the Theme's enter motion and slides in from the west,
 * so under the Default Theme it is the 400ms ease-out it shipped as. A recipe
 * with no channel cuts.
 */
export const rowMotionModeToken = {
	type: 'animation-recipe',
	label: 'Row enter and exit',
	settingsGroup: 'table',
	default: {
		token: 'motion-enter',
		movement: {
			fade: { opacity: 0 },
			slide: { direction: 'west', distanceMode: 'fixed', distance: 20 },
		},
	},
} as const;
