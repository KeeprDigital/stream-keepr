<script setup lang="ts">
const eventStore = useEventStore()
const playerStore = usePlayerStore()

const items = [
  {
    label: 'Players',
    icon: 'i-lucide-user',
    slot: 'players',
  },
  {
    label: 'Event',
    icon: 'i-lucide-calendar',
    slot: 'event',
  },
]

async function saveEvent() {
  await eventStore.save()
}

function reset() {
  eventStore.reset()
}

async function savePlayer() {
  await playerStore.save()
}
</script>

<template>
  <UTabs :items="items" variant="link" size="xl">
    <template #players="{ item }">
      <div class="flex flex-row gap-4">
        <PlayerControl v-model="playerStore.playerState.playerOne" />
        <PlayerControl v-model="playerStore.playerState.playerTwo" />
      </div>
    </template>

    <template #event="{ item }">
      <EventControl v-model="eventStore.eventState" />
    </template>
  </UTabs>
</template>

<!--

<template>
  <UPage>
    <UPageBody class="overlay-controls-body">
      <div class="overlay-controls">
        <div class="overlay-controls-players">

        </div>
        <UCard>
          <template #header>
            <h3>Event</h3>
          </template>

        </UCard>
      </div>
      <div class="overlay-controls-buttons">
        <UButton
          size="xl"
          variant="outline"
          @click="savePlayer"
        >
          Update Player
        </UButton>
        <UButton
          size="xl"
          color="warning"
          variant="outline"
          @click="reset"
        >
          Reset
        </UButton>
      </div>
    </UPageBody>
  </UPage>
</template>

<style scoped>
.overlay-controls-body {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.overlay-controls-players {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.overlay-controls {
  display: flex;
  flex-direction: row;
  gap: 2rem;
}
</style> -->
