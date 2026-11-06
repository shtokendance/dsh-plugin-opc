import React from 'react'
import icon from './opc-icon.png'
export const labels = { knowledge: 'OPC 知识库', skills: 'OPC 技能', mcp: 'OPC MCP' }
export function OpcIcon({ size = 16 }: { size?: number | string }) {
  return <img src={icon} alt="" width={size} height={size} style={{ verticalAlign: 'middle', objectFit: 'contain' }} />
}
