import { reactive } from 'vue'

// Keep dismissed rows hidden when a drawer or environment page is reopened.
// Operation IDs identify records across management targets; no server data is removed.
export const dismissedExportRecords = reactive(new Set<string>())
