export interface DeploymentAttemptProgress {
  phase: 'submitting' | 'submission_rejected' | 'blocked_previous' | 'unknown' | 'queued' | 'building' |
    'preparing' | 'migrating' | 'starting' | 'checking_domain' | 'confirming' | 'succeeded' |
    'cancelling' | 'cleaning' | 'cancelled' | 'restoring' | 'restored' | 'failed' | 'recovery_required'
  phase_started_at?: number
  active_version?: number
  stalled?: boolean
  can_cancel?: boolean
  retry_safe?: boolean
  failure_kind?: 'build' | 'startup' | 'domain' | 'platform'
  blocking_request_id?: string
  last_observed_phase?: DeploymentAttemptProgress['phase']
  last_observed_at?: number
}

export function followsDeploymentAttempt(progress?: DeploymentAttemptProgress) {
  return Boolean(progress && !['succeeded', 'submission_rejected', 'cancelled', 'restored', 'failed', 'recovery_required'].includes(progress.phase))
}
