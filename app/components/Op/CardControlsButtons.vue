<script lang="ts" setup>
const cardStore = useOpCardStore()

const {
  previewCard,
  activeCard,
} = storeToRefs(cardStore)

function cardAction(action: OpPreviewCardAction) {
  cardStore.controlPreviewCard(action)
}
</script>

<template>
  <div v-if="previewCard" class="flex flex-col gap-2">
    <UButton
      v-if="activeCard"
      variant="outline"
      icon="i-lucide-replace"
      block
      color="warning"
      @click="cardAction('show')"
    >
      Replace
    </UButton>
    <UButton
      v-else
      variant="outline"
      icon="i-lucide-eye"
      block
      @click="cardAction('show')"
    >
      Show
    </UButton>
  </div>
</template>
