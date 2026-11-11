/** The graphics editor's keyboard shortcuts, as its shortcut list shows them. */
export const GRAPHICS_EDITOR_SHORTCUTS = [
	{
		keys: ['⌘', 'Z'],
		label: 'Undo',
	},
	{
		keys: ['⌘', '⇧', 'Z'],
		label: 'Redo',
	},
	{
		keys: ['⌘', 'D'],
		label: 'Duplicate',
	},
	{
		keys: ['⌘', 'C'],
		label: 'Copy',
	},
	{
		keys: ['⌘', 'V'],
		label: 'Paste, here or on another Screen',
	},
	{
		keys: ['⌘', '⌥', 'C'],
		label: 'Copy style',
	},
	{
		keys: ['⌘', '⌥', 'V'],
		label: 'Paste style',
	},
	{
		keys: ['⌫'],
		label: 'Delete',
	},
	{
		keys: ['←↑↓→'],
		label: 'Nudge 1px (⇧ 10px)',
	},
	{
		keys: ['⌘', ']'],
		label: 'Bring forward (⇧ to front)',
	},
	{
		keys: ['⌘', '['],
		label: 'Send backward (⇧ to back)',
	},
	{
		keys: ['⌘', '⇧', 'H'],
		label: 'Hide or show',
	},
	{
		keys: ['⌘', 'G'],
		label: 'Group the selected layers',
	},
	{
		keys: ['⌘', '⇧', 'G'],
		label: 'Ungroup the selected group',
	},
	{
		keys: ['F2'],
		label: 'Rename the focused layer (or double-click it)',
	},
	{
		keys: ['⌘', '⇧', 'L'],
		label: 'Lock or unlock against canvas edits',
	},
	{
		keys: ['⌘ click'],
		label: 'Add or remove a layer from the selection',
	},
	{
		keys: ['⇧ click'],
		label: 'Select a run of layers in the list',
	},
	{
		keys: ['Esc'],
		label: 'Select one layer, then the canvas',
	},
	{
		keys: ['⇧ drag'],
		label: 'Keep aspect ratio (rotate in 15° steps)',
	},
	{
		keys: ['⌥ drag'],
		label: 'Turn off snapping',
	},
	{
		keys: ['⌘ scroll'],
		label: 'Zoom the preview',
	},
	{
		keys: ['Space drag'],
		label: 'Pan the preview (or middle-drag)',
	},
	{
		keys: ['⌘', '0'],
		label: 'Fit the preview',
	},
	{
		keys: ['⌘', '1'],
		label: 'Preview at 100%',
	},
] as const;
