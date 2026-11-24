import React from 'react'
import { useI18n } from './i18n.tsx'

export const DEFAULT_PAGE_SIZE = 6
export const PAGE_SIZE_OPTIONS = [6, 12, 24] as const

export function paginateItems<T>(items: readonly T[], page: number, pageSize: number) {
  const safeSize = Math.max(1, pageSize)
  const totalPages = Math.max(1, Math.ceil(items.length / safeSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const startIndex = (currentPage - 1) * safeSize
  const endIndex = Math.min(items.length, startIndex + safeSize)
  return {
    pageItems: items.slice(startIndex, endIndex),
    currentPage,
    totalPages,
    startIndex,
    endIndex,
  }
}

function buildPageTokens(currentPage: number, totalPages: number): (number | 'ellipsis-left' | 'ellipsis-right')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }
  const tokens: (number | 'ellipsis-left' | 'ellipsis-right')[] = [1]
  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)
  if (start > 2) tokens.push('ellipsis-left')
  for (let page = start; page <= end; page++) tokens.push(page)
  if (end < totalPages - 1) tokens.push('ellipsis-right')
  tokens.push(totalPages)
  return tokens
}

export const paginationStyles = `
.opc-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
  font-size: 12px;
  color: #64748b;
}
.opc-pagination-info {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.opc-pagination-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.opc-page-size {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
}
.opc-page-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.opc-page-btn:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #0f172a;
}
.opc-page-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.opc-page-btn.is-active {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
  font-weight: 600;
}
.opc-page-btn.is-active:hover:not(:disabled) {
  background: #1d4ed8;
  border-color: #1d4ed8;
  color: #ffffff;
}
.opc-page-ellipsis {
  padding: 0 4px;
  color: #94a3b8;
  user-select: none;
}
`

export function Pagination({
  totalItems,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  totalItems: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const { t } = useI18n()
  if (totalItems <= 0) return null
  const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const tokens = buildPageTokens(currentPage, totalPages)

  return (
    <nav className="opc-pagination" aria-label={t("common.pagination.pagination")}>
      <span className="opc-pagination-info">
        {t("common.pagination.itemsPage", { total: totalItems, page: currentPage, pages: totalPages })}
      </span>
      <div className="opc-pagination-controls">
        <select
          className="opc-page-size"
          aria-label={t("common.pagination.itemsPerPage")}
          value={pageSize}
          onChange={event => onPageSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map(size => (
            <option key={size} value={size}>{t("common.pagination.page", { size })}</option>
          ))}
        </select>
        <button
          type="button"
          className="opc-page-btn"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          {t("common.pagination.prev")}
        </button>
        {tokens.map(token => (
          typeof token === 'number' ? (
            <button
              key={token}
              type="button"
              className={`opc-page-btn ${token === currentPage ? 'is-active' : ''}`}
              aria-label={t("common.pagination.page_2", { page: token })}
              aria-current={token === currentPage ? 'page' : undefined}
              onClick={() => onPageChange(token)}
            >
              {token}
            </button>
          ) : (
            <span key={token} className="opc-page-ellipsis" aria-hidden="true">…</span>
          )
        ))}
        <button
          type="button"
          className="opc-page-btn"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {t("common.pagination.next")}
        </button>
      </div>
    </nav>
  )
}
