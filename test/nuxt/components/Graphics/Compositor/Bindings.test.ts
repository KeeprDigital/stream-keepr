import type { BroadcastGraphicConfig, GraphicInputDeclaration } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';

enableAutoUnmount(afterEach);

/**
 * Authoring the Event Data one Broadcast Graphic reads.
 *
 * Every assertion is the same rule from the author's side: the surface offers only
 * what the write path accepts and what resolution can actually resolve. A derivation
 * the relation table does not yield is not in the list; a field of another kind, of
 * another game, or of a type this Graphic Input cannot hold is not in the list; and a
 * second Graphic Input Binding for one Graphic Input has nowhere to be written.
 */

const SlotOnlyStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: [String, Number], required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<select :value="modelValue" />',
});

const UInputStub = defineComponent({
	name: 'UInput',
	props: { modelValue: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" />',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: { disabled: { type: Boolean, required: false } },
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

function textInput(key: string, label = key): GraphicInputDeclaration {
	return {
		type: 'text',
		key,
		label,
		required: false,
		updatePolicy: 'staged',
		default: '',
		maxLength: 200,
	};
}

function numberInput(key: string, label = key): GraphicInputDeclaration {
	return {
		type: 'number',
		key,
		label,
		required: false,
		updatePolicy: 'staged',
		default: null,
		integer: true,
	};
}

function graphic(overrides: Partial<BroadcastGraphicConfig> = {}): BroadcastGraphicConfig[] {
	return [{ id: 'lower-third', name: 'Lower Third', items: [], ...overrides }];
}

const GRAPHIC_SELECTED: GraphicsSelectionTarget = { type: 'graphic', graphicId: 'lower-third' };

async function mountComponent(options: {
	graphics: BroadcastGraphicConfig[];
	selectedTarget?: GraphicsSelectionTarget;
	game?: string;
	writable?: boolean;
}) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Bindings.vue';
	const { default: Bindings } = await import(componentPath);

	return mount(Bindings, {
		props: {
			graphics: options.graphics,
			selectedTarget: options.selectedTarget ?? GRAPHIC_SELECTED,
			// `in` rather than `??`, so a caller can mount the unresolved-game case
			// deliberately instead of having it defaulted back to a game.
			game: 'game' in options ? options.game : 'mtg',
			writable: options.writable ?? true,
		},
		global: {
			stubs: {
				UFormField: SlotOnlyStub,
				USelect: USelectStub,
				UInput: UInputStub,
				UButton: UButtonStub,
				UBadge: true,
				UIcon: true,
			},
		},
	});
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

function emittedGraphics(wrapper: Wrapper, index = 0) {
	return wrapper.emitted('update:graphics')?.[index]?.[0] as BroadcastGraphicConfig[];
}

function selects(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents({ name: 'USelect' })
		.filter(select => select.attributes('data-testid') === testId);
}

function buttons(wrapper: Wrapper, testId: string) {
	return wrapper.findAllComponents(UButtonStub)
		.filter(button => button.attributes('data-testid') === testId);
}

function optionLabels(wrapper: Wrapper, testId: string, index = 0) {
	const items = selects(wrapper, testId)[index]?.props('items') as { label: string }[] | undefined;
	return (items ?? []).map(item => item.label);
}

const SLOT = { key: 'slot', label: 'Slot', kind: 'feature-match-slot' as const };
const PLAYER = { key: 'player', label: 'Featured Player', kind: 'player' as const };

describe('graphicsCompositorBindings', () => {
	describe('authoring Graphic Source Selections', () => {
		it('offers every single-entity kind a Graphic Source Selection may select', async () => {
			const wrapper = await mountComponent({ graphics: graphic() });

			expect(optionLabels(wrapper, 'graphic-source-kind')).toEqual([
				'Current Event',
				'Player',
				'Talent',
				'Phase',
				'Round',
				'Match',
				'Feature Match Slot',
				'Archetype',
			]);
		});

		it('declares a Graphic Source Selection of the chosen kind', async () => {
			const wrapper = await mountComponent({ graphics: graphic() });

			selects(wrapper, 'graphic-source-kind')[0]?.vm.$emit('update:modelValue', 'feature-match-slot');
			await nextTick();
			buttons(wrapper, 'graphic-source-add')[0]?.vm.$emit('click');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.sources).toEqual([
				{ key: 'source-1', label: 'Source 1', kind: 'feature-match-slot' },
			]);
		});

		it('renames one without moving the key its bindings name', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({ sources: [PLAYER] }),
			});

			wrapper.findAllComponents(UInputStub)[0]?.vm.$emit('update:modelValue', 'Champion');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.sources).toEqual([{ ...PLAYER, label: 'Champion' }]);
			expect(wrapper.get('[data-testid="graphic-source-key"]').text()).toBe('player');
		});

		it('removes one, and the Graphic Input Bindings that read it', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER],
					bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
				}),
			});

			buttons(wrapper, 'graphic-source-delete')[0]?.vm.$emit('click');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.sources).toEqual([]);
			expect(emittedGraphics(wrapper)[0]!.bindings).toEqual([]);
		});

		it('says which Graphic Source Selections an operator is asked to pick', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					sources: [
						{ key: 'event', label: 'Event', kind: 'event' },
						SLOT,
						{ key: 'p1', label: 'Player 1', kind: 'player', from: { sourceKey: 'slot', relation: 'player1' } },
					],
				}),
			});

			const notes = wrapper.findAll('[data-testid="graphic-source-note"]').map(note => note.text());
			expect(notes[0]).toBe('Resolves the Event this Screen belongs to.');
			expect(notes[1]).toBe('Generates one picker in Live Control.');
			expect(notes[2]).toBe('Follows Slot — no picker of its own.');
		});

		it('writes nothing when an author clears the name, so the previous one stands', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({ sources: [PLAYER] }),
			});

			wrapper.findAllComponents(UInputStub)[0]?.vm.$emit('update:modelValue', '');
			await nextTick();

			// A nameless Graphic Source Selection is one the write path refuses.
			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});

		it('stops declaring at the cap this Broadcast Graphic may hold, and says why', async () => {
			const full = Array.from({ length: 8 }, (_, index) => ({
				key: `source-${index}`,
				label: `Source ${index}`,
				kind: 'player' as const,
			}));
			const wrapper = await mountComponent({ graphics: graphic({ sources: full }) });

			expect(buttons(wrapper, 'graphic-source-add')[0]?.props('disabled')).toBe(true);
			expect(wrapper.get('[data-testid="graphic-source-budget-spent"]').text())
				.toContain('one Broadcast Graphic may declare 8');
		});

		it('counts the whole Screen against the whole-Screen budget', async () => {
			// Five Broadcast Graphics of eight spend all forty, so the Screen has no room
			// left even on a graphic that has declared none of its own.
			const spent = Array.from({ length: 5 }, (_, graphicIndex) => ({
				id: `graphic-${graphicIndex}`,
				name: `Graphic ${graphicIndex}`,
				items: [],
				sources: Array.from({ length: 8 }, (_, index) => ({
					key: `s${graphicIndex}x${index}`,
					label: `Source ${graphicIndex}-${index}`,
					kind: 'player' as const,
				})),
			}));
			const wrapper = await mountComponent({
				graphics: [...spent, { id: 'lower-third', name: 'Lower Third', items: [] }],
			});

			expect(buttons(wrapper, 'graphic-source-add')[0]?.props('disabled')).toBe(true);
			expect(wrapper.get('[data-testid="graphic-source-budget-spent"]').text())
				.toContain('the Screen 40 in total');
		});

		it('offers the current Event no derivation, because it follows nothing', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({ sources: [{ key: 'event', label: 'Event', kind: 'event' }] }),
			});

			expect(selects(wrapper, 'graphic-source-derivation')).toHaveLength(0);
		});
	});

	describe('deriving one Graphic Source Selection from another', () => {
		it('offers only the relationships that yield this selection\'s kind', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({ sources: [SLOT, PLAYER] }),
			});

			// The Player's own picker is second; a Feature Match Slot is reached by nothing,
			// so the Slot's own offers only the operator pick.
			expect(optionLabels(wrapper, 'graphic-source-derivation', 0)).toEqual(['An operator picks it']);
			expect(optionLabels(wrapper, 'graphic-source-derivation', 1)).toEqual([
				'An operator picks it',
				'Player 1 of Slot',
				'Player 2 of Slot',
			]);
		});

		it('never offers a Graphic Source Selection that already follows this one', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					sources: [
						{ key: 'match', label: 'Match', kind: 'match' },
						{ key: 'round', label: 'Round', kind: 'round', from: { sourceKey: 'match', relation: 'round' } },
					],
				}),
			});

			// A Round follows the Match. Offering "Round of Match" back to the Match would
			// close the `from` cycle the write path refuses — so a Match derived from nothing
			// here has only the operator pick.
			expect(optionLabels(wrapper, 'graphic-source-derivation', 0)).toEqual(['An operator picks it']);
		});

		it('stores a chosen derivation and clears it back to an operator pick', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({ sources: [SLOT, PLAYER] }),
			});

			selects(wrapper, 'graphic-source-derivation')[1]?.vm.$emit('update:modelValue', 'slot:player1');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.sources![1]).toEqual({
				...PLAYER,
				from: { sourceKey: 'slot', relation: 'player1' },
			});

			const derived = await mountComponent({
				graphics: graphic({ sources: [SLOT, { ...PLAYER, from: { sourceKey: 'slot', relation: 'player1' } }] }),
			});
			selects(derived, 'graphic-source-derivation')[1]?.vm.$emit('update:modelValue', '');
			await nextTick();

			expect(emittedGraphics(derived)[0]!.sources![1]).toEqual(PLAYER);
		});
	});

	describe('authoring Graphic Input Bindings', () => {
		const bindable = graphic({
			inputs: [textInput('name', 'Presenter name'), numberInput('life', 'Life total')],
			sources: [PLAYER, SLOT],
		});

		it('asks for a Graphic Source Selection before offering any binding', async () => {
			const wrapper = await mountComponent({ graphics: graphic({ inputs: [textInput('name')] }) });

			expect(wrapper.find('[data-testid="graphic-binding-needs-source"]').exists()).toBe(true);
			expect(selects(wrapper, 'graphic-binding-source')).toHaveLength(0);
		});

		it('presents common and game-specific fields separately, and only this Event\'s game', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER],
					bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
				}),
			});

			const items = selects(wrapper, 'graphic-binding-field')[0]?.props('items') as { label: string }[][];
			expect(items[0]![0]).toEqual({ type: 'label', label: 'Common fields' });
			expect(items[0]!.map(item => item.label)).toContain('Record (W-L-D)');
			expect(items[1]![0]).toEqual({ type: 'label', label: 'Magic: The Gathering fields' });
			expect(items[1]!.map(item => item.label)).toEqual(['Magic: The Gathering fields', 'Deck name', 'Deck colours']);
			// One Piece's Leader is not this Event's game, so it is not offered at all.
			expect(items.flat().map(item => item.label)).not.toContain('Leader');
		});

		it('offers only fields of the Graphic Input\'s own type', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [numberInput('life')],
					sources: [PLAYER],
					bindings: [{ inputKey: 'life', sourceKey: 'player', fieldId: 'player.wins' }],
				}),
			});

			const labels = (selects(wrapper, 'graphic-binding-field')[0]?.props('items') as { label: string }[][])
				.flat()
				.map(item => item.label);
			expect(labels).toContain('Wins');
			// The composed record is text: a number Graphic Input cannot render it, and the
			// catalog decides that rather than a conversion nobody authored.
			expect(labels).not.toContain('Record (W-L-D)');
		});

		it('states why a Graphic Source Selection has nothing this Graphic Input can read', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [numberInput('life', 'Life total')],
					sources: [{ key: 'talent', label: 'Commentator', kind: 'talent' }],
					bindings: [],
				}),
			});

			selects(wrapper, 'graphic-binding-source')[0]?.vm.$emit('update:modelValue', 'talent');
			await nextTick();

			expect(wrapper.get('[data-testid="graphic-binding-unavailable"]').text())
				.toBe('No Talent field holds a number value on this Event.');
			expect(selects(wrapper, 'graphic-binding-field')).toHaveLength(0);
		});

		it('says so when a binding reads a Graphic Source Selection nothing declares', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER],
					// Authorable only by writing the mode configuration directly: removing a
					// Graphic Source Selection here takes the bindings reading it with it.
					bindings: [{ inputKey: 'name', sourceKey: 'departed', fieldId: 'player.name' }],
				}),
			});

			expect(wrapper.get('[data-testid="graphic-binding-unavailable"]').text())
				.toBe('This reads departed, which this Broadcast Graphic no longer declares.');
		});

		it('binds one Graphic Input to one field of one Graphic Source Selection', async () => {
			const wrapper = await mountComponent({ graphics: bindable });

			selects(wrapper, 'graphic-binding-source')[0]?.vm.$emit('update:modelValue', 'player');
			await nextTick();
			selects(wrapper, 'graphic-binding-field')[0]?.vm.$emit('update:modelValue', 'player.record');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.bindings).toEqual([
				{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.record' },
			]);
		});

		it('replaces the binding a Graphic Input already had rather than adding a second', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER],
					bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
				}),
			});

			selects(wrapper, 'graphic-binding-field')[0]?.vm.$emit('update:modelValue', 'player.pronouns');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.bindings).toEqual([
				{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.pronouns' },
			]);
		});

		it('drops a field the newly chosen Graphic Source Selection kind does not have', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER, SLOT],
					bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
				}),
			});

			selects(wrapper, 'graphic-binding-source')[0]?.vm.$emit('update:modelValue', 'slot');
			await nextTick();

			// `player.name` is a catalog name the wire would accept on a Feature Match Slot
			// selection and then never resolve. The author chooses a Slot field instead.
			expect(emittedGraphics(wrapper)[0]!.bindings).toEqual([]);
		});

		it('keeps the field when the new Graphic Source Selection is of the same kind', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER, { key: 'opponent', label: 'Opponent', kind: 'player' }],
					bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
				}),
			});

			selects(wrapper, 'graphic-binding-source')[0]?.vm.$emit('update:modelValue', 'opponent');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.bindings).toEqual([
				{ inputKey: 'name', sourceKey: 'opponent', fieldId: 'player.name' },
			]);
		});

		it('unbinds a Graphic Input, leaving it a manually entered value', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER],
					bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
				}),
			});

			buttons(wrapper, 'graphic-binding-clear')[0]?.vm.$emit('click');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.bindings).toEqual([]);
		});
	});

	/**
	 * The window before this Event's game arrives.
	 *
	 * The catalog offers every game's fields when it is passed no game, which is the
	 * right answer for a surface with no Event context and the wrong one here: the
	 * Event has a game, it has simply not loaded, and a One Piece field bound on a
	 * Magic Event is not something the later load takes back.
	 */
	describe('before this Event\'s game is known', () => {
		const unresolved = {
			graphics: graphic({
				inputs: [textInput('name', 'Presenter name')],
				sources: [PLAYER],
			}),
			game: undefined,
		};

		it('offers no binding control at all, and says what it is waiting for', async () => {
			const wrapper = await mountComponent(unresolved);

			expect(selects(wrapper, 'graphic-binding-source')).toHaveLength(0);
			expect(selects(wrapper, 'graphic-binding-field')).toHaveLength(0);
			expect(wrapper.get('[data-testid="graphic-binding-awaits-game"]').text())
				.toContain('Waiting for this Event\'s game');
		});

		it('still authors Graphic Source Selections, which no game decides', async () => {
			const wrapper = await mountComponent(unresolved);

			buttons(wrapper, 'graphic-source-add')[0]?.vm.$emit('click');
			await nextTick();

			expect(emittedGraphics(wrapper)[0]!.sources).toHaveLength(2);
		});

		it('offers the fields once the game arrives', async () => {
			const wrapper = await mountComponent(unresolved);
			await wrapper.setProps({ game: 'mtg' });

			expect(selects(wrapper, 'graphic-binding-source')).toHaveLength(1);
			expect(wrapper.find('[data-testid="graphic-binding-awaits-game"]').exists()).toBe(false);
		});
	});

	describe('an observing session', () => {
		it('reads every Graphic Source Selection and Graphic Input Binding without changing one', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({
					inputs: [textInput('name')],
					sources: [PLAYER],
					bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
				}),
				writable: false,
			});

			expect(wrapper.find('[data-graphic-source-selection="player"]').exists()).toBe(true);
			buttons(wrapper, 'graphic-source-add')[0]?.vm.$emit('click');
			buttons(wrapper, 'graphic-source-delete')[0]?.vm.$emit('click');
			buttons(wrapper, 'graphic-binding-clear')[0]?.vm.$emit('click');
			selects(wrapper, 'graphic-binding-field')[0]?.vm.$emit('update:modelValue', 'player.pronouns');
			await nextTick();

			expect(wrapper.emitted('update:graphics')).toBeUndefined();
		});
	});

	describe('where the surface appears', () => {
		it('appears with the Broadcast Graphic selected rather than one of its Graphic Items', async () => {
			const wrapper = await mountComponent({
				graphics: graphic({ sources: [PLAYER] }),
				selectedTarget: { type: 'canvas' },
			});

			expect(wrapper.find('[data-testid="graphic-event-data-bindings"]').exists()).toBe(false);
		});
	});
});
