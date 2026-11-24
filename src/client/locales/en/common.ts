import type { common as zhCommon } from '../zh/common.ts'

export const common = {
  "common.module.knowledge": "OPC Knowledge",
  "common.module.skills": "OPC Skills",
  "common.module.mcp": "OPC MCP",
  "common.module.apps": "OPC Apps",
  "common.close": "Close",
  "common.recommended": "Recommended",
  "common.required": "Required",
  "common.refresh": "Refresh",
  "common.copied": "Copied",
  "common.notice.warning": "Warning",
  "common.notice.notice": "Notice",
  "common.notice.error": "Error",
  "common.pagination.pagination": "Pagination",
  "common.pagination.itemsPage": "{total} items · Page {page} / {pages}",
  "common.pagination.itemsPerPage": "Items per page",
  "common.pagination.page": "{size} / page",
  "common.pagination.prev": "Prev",
  "common.pagination.page_2": "Page {page}",
  "common.pagination.next": "Next",
} as const satisfies Record<keyof typeof zhCommon, string>
