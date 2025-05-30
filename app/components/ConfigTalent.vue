<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

type Props = {
  dirty: boolean
}

type Emits = {
  (e: 'save'): void
  (e: 'reset'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const state = defineModel<ConfigTalent>()

const editingTalents = ref<Set<number>>(new Set())
const editingValues = ref<Record<number, string>>({})

// Computed to check if any talents are being edited
const hasActiveEdits = computed(() => editingTalents.value.size > 0)

// Computed to determine if save should be disabled
const canSave = computed(() => props.dirty && !hasActiveEdits.value)

function addTalent() {
  if (!state.value) {
    state.value = { talents: [] }
  }

  const newTalent = { name: '' }
  state.value.talents.push(newTalent)

  const newIndex = state.value.talents.length - 1
  startEditing(newIndex)
}

function startEditing(index: number) {
  editingTalents.value.add(index)
  editingValues.value[index] = state.value?.talents[index]?.name || ''
}

function stopEditing(index: number) {
  editingTalents.value.delete(index)
  delete editingValues.value[index]
}

function saveTalentEdit(index: number) {
  if (state.value?.talents[index] && editingValues.value[index] !== undefined) {
    const trimmedValue = editingValues.value[index].trim()

    if (trimmedValue) {
      state.value.talents[index].name = trimmedValue
      stopEditing(index)
    }
  }
}

function cancelTalentEdit(index: number) {
  if (state.value?.talents[index]) {
    // If this is a new talent (empty name), remove it
    if (!state.value.talents[index].name) {
      removeTalent(index)
    }
    else {
      stopEditing(index)
    }
  }
}

function removeTalent(index: number) {
  if (state.value?.talents) {
    state.value.talents.splice(index, 1)
    stopEditing(index)

    // Update edit state indices after removal
    const newEditingTalents = new Set<number>()
    const newEditingValues: Record<number, string> = {}

    editingTalents.value.forEach((editIndex) => {
      if (editIndex > index) {
        newEditingTalents.add(editIndex - 1)
        // Fix: Check if the value exists before using it
        const editValue = editingValues.value[editIndex]
        if (editValue !== undefined) {
          newEditingValues[editIndex - 1] = editValue
        }
      }
      else if (editIndex < index) {
        newEditingTalents.add(editIndex)
        // Fix: Check if the value exists before using it
        const editValue = editingValues.value[editIndex]
        if (editValue !== undefined) {
          newEditingValues[editIndex] = editValue
        }
      }
    })

    editingTalents.value = newEditingTalents
    editingValues.value = newEditingValues
  }
}

function getDropdownItems(index: number): DropdownMenuItem[] {
  return [
    {
      label: 'Edit member',
      icon: 'i-lucide-edit',
      onSelect: () => startEditing(index),
    },
    {
      label: 'Remove member',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => removeTalent(index),
    },
  ]
}

function handleKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveTalentEdit(index)
  }
  else if (event.key === 'Escape') {
    event.preventDefault()
    cancelTalentEdit(index)
  }
}

function handleSave() {
  if (canSave.value) {
    emit('save')
  }
}

function handleReset() {
  // Clear all edit states when resetting
  editingTalents.value.clear()
  editingValues.value = {}
  emit('reset')
}
</script>

<template>
  <UCard variant="subtle">
    <div v-if="!state?.talents?.length" class="text-center py-8">
      <div class="text-muted">
        <UIcon name="i-lucide-users" class="w-8 h-8 mx-auto mb-2" />
        <p class="text-sm">
          No talents added yet
        </p>
      </div>
    </div>

    <ul v-else role="list" class="divide-y divide-default">
      <li
        v-for="(talent, index) in state.talents"
        :key="index"
        class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
      >
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <!-- Edit Mode -->
          <div v-if="editingTalents.has(index)" class="flex items-center gap-2 flex-1">
            <UInput
              v-model="editingValues[index]"
              placeholder="Enter talent name"
              class="flex-1"
              :ui="{ root: 'flex-1' }"
              autofocus
              @keydown="handleKeydown($event, index)"
            />
            <div class="flex items-center gap-1">
              <UButton
                icon="i-lucide-check"
                color="success"
                variant="ghost"
                size="xs"
                :disabled="!editingValues[index]?.trim()"
                @click="saveTalentEdit(index)"
              />
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="cancelTalentEdit(index)"
              />
            </div>
          </div>

          <!-- Display Mode -->
          <div v-else class="text-sm min-w-0 flex-1">
            <p class="text-highlighted truncate font-medium">
              {{ talent.name }}
            </p>
          </div>
        </div>

        <!-- Actions (only show when not editing) -->
        <div v-if="!editingTalents.has(index)" class="flex items-center gap-3">
          <UDropdownMenu
            :items="getDropdownItems(index)"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
            />
          </UDropdownMenu>
        </div>
      </li>
    </ul>

    <template #footer>
      <div class="flex justify-between items-center gap-4">
        <UButton
          label="Reset"
          color="error"
          variant="outline"
          type="button"
          :disabled="!props.dirty"
          @click="handleReset"
        />
        <UButton
          label="Add talent"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          type="button"
          @click="addTalent"
        />
        <UTooltip
          v-if="hasActiveEdits && props.dirty"
          text="Complete or cancel active edits before saving"
        >
          <UButton
            label="Save"
            color="primary"
            variant="outline"
            type="submit"
            :disabled="!canSave"
            @click="handleSave"
          />
        </UTooltip>
        <UButton
          v-else
          label="Save"
          color="primary"
          variant="outline"
          type="submit"
          :disabled="!canSave"
          @click="handleSave"
        />
      </div>
    </template>
  </UCard>
</template>
