export interface DeploymentAttemptProgress {
  phase: 'submitting' | 'submission_rejected' | 'blocked_previous' | 'unknown' | 'queued' | 'building' |
    'preparing' | 'migrating' | 'starting' | 'checking_domain' | 'confirming' | 'succeeded' |
    'cancelling' | 'cleaning' | 'cancelled' | 'restoring' | 'restored' | 'failed' | 'recovery_required'
  phase_started_at?: number
  active_version?: number
  stalled?: boolean
  can_cancel?: boolean
  retry_safe?: boolean
  failure_kind?: 'build' | 'build_timeout' | 'startup' | 'domain' | 'platform'
  blocking_request_id?: string
  last_observed_phase?: DeploymentAttemptProgress['phase']
  last_observed_at?: number
}

export function isBuildTimeout(progress?: DeploymentAttemptProgress, error?: unknown) {
  return progress?.failure_kind === 'build_timeout' ||
    (progress?.failure_kind === 'platform' && typeof error === 'string' &&
      error.startsWith('本次构建超过等待上限，平台正在停止任务并清理临时资源'))
}

export function followsDeploymentAttempt(progress?: DeploymentAttemptProgress) {
  return Boolean(progress && !['succeeded', 'submission_rejected', 'cancelled', 'restored', 'failed', 'recovery_required'].includes(progress.phase))
}
