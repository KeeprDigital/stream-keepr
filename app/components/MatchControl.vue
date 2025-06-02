<script lang="ts" setup>
import type { DropdownMenuItem } from '@nuxt/ui'

type Props = {
  match: MatchData
  dirty: boolean
  orientation: 'horizontal' | 'vertical'
}
type Emits = {
  (e: 'update', match: MatchData): void
  (e: 'save', id: string): void
  (e: 'remove', id: string): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const localMatch = ref<MatchData>(JSON.parse(JSON.stringify(props.match)))

watch(() => props.match, (newVal) => {
  localMatch.value = JSON.parse(JSON.stringify(newVal))
}, { deep: true })

const editingName = ref(false)

const items = ref<DropdownMenuItem[]>([
  {
    label: 'Edit Name',
    icon: 'i-lucide-pencil',
    onSelect: () => editingName.value = true,
  },
  {
    label: 'Delete Match',
    icon: 'i-lucide-trash',
    color: 'error',
    onSelect: () => emit('remove', localMatch.value.id),
  },
])

function saveName() {
  if (localMatch.value?.name) {
    const trimmedValue = localMatch.value.name.trim()

    if (trimmedValue) {
      localMatch.value.name = trimmedValue
      emit('update', localMatch.value)
      editingName.value = false
    }
  }
}

function cancelName() {
  localMatch.value.name = props.match.name
  editingName.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveName()
  }
  else if (event.key === 'Escape') {
    event.preventDefault()
    cancelName()
  }
}

function updatePlayerOne(updatedPlayer: PlayerData) {
  localMatch.value = {
    ...localMatch.value,
    playerOne: updatedPlayer,
  }
  emit('update', localMatch.value)
}

function updatePlayerTwo(updatedPlayer: PlayerData) {
  localMatch.value = {
    ...localMatch.value,
    playerTwo: updatedPlayer,
  }
  emit('update', localMatch.value)
}
</script>

<template>
  <UCard
    v-if="localMatch"
    variant="subtle"
  >
    <template #header>
      <div class="grid grid-cols-3 items-center gap-4 w-full">
        <div class="col-start-1">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- Edit Mode -->
            <div v-if="editingName" class="flex items-center gap-2 flex-1">
              <UInput
                v-model="localMatch.name"
                class="flex-1"
                :ui="{ root: 'flex-1' }"
                autofocus
                @keydown="handleKeydown($event)"
              />
              <div class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-check"
                  color="success"
                  variant="ghost"
                  size="xs"
                  :disabled="!localMatch.name?.trim()"
                  @click="saveName"
                />
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="cancelName"
                />
              </div>
            </div>

            <!-- Display Mode -->
            <div v-else class="text-sm min-w-0 flex-1">
              <p class="text-highlighted truncate font-medium">
                {{ localMatch.name }}
              </p>
            </div>
          </div>
        </div>

        <span
          class="col-start-2 font-mono text-center"
        >35:00</span>

        <UDropdownMenu
          arrow
          :items="items"
          :ui="{
            content: 'w-48',
          }"
          class="col-start-3"
        >
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            class="place-self-end"
          />
        </UDropdownMenu>
      </div>
    </template>
    <div class="flex flex-row gap-4">
      <div>
        <h2 class="font-bold text-center mb-4">
          {{ orientation === 'vertical' ? 'Top Player' : 'Left Player' }}
        </h2>
        <MatchPlayerControl
          :player="localMatch.playerOne"
          @update="updatePlayerOne"
        />
      </div>
      <div>
        <USeparator orientation="vertical" />
      </div>
      <div>
        <h2 class="font-bold text-center mb-4">
          {{ orientation === 'vertical' ? 'Bottom Player' : 'Right Player' }}
        </h2>
        <MatchPlayerControl
          :player="localMatch.playerTwo"
          @update="updatePlayerTwo"
        />
      </div>
    </div>
    <template #footer>
      <div
        class="flex justify-end items-center gap-4"
      >
        <UButton
          color="primary"
          variant="outline"
          :disabled="!dirty"
          @click="emit('save', localMatch.id)"
        >
          Save
        </UButton>
      </div>
    </template>
  </UCard>
</template>
