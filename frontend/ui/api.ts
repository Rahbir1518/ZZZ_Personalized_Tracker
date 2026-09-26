/**
 * Typed client for the local sidecar.
 *
 * The origin and token come from the Electron main process over the preload
 * bridge — the renderer never learns them any other way, and the token means a
 * different local process cannot drive the user's HoYoLAB session by guessing
 * the port.
 */

import type {
  Agent,
  AgentDetail,
  AgentSynergy,
  Analysis,
  ApiErrorCode,
  AuthResult,
  DiscSetDetail,
  DiscSetOverview,
  EngineDetail,
  PullHistory,
  SyncStatus
} from './types'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly hint: string
  readonly status: number

  constructor(code: ApiErrorCode, message: string, hint = '', status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
    this.status = status
  }
}

interface SidecarInfo {
  origin: string
  token: string
}

let cached: SidecarInfo | null = null

async function sidecar(): Promise<SidecarInfo> {
  if (cached === null) cached = await window.tracker.sidecar.info()
  return cached
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { origin, token } = await sidecar()

  let response: Response
  try {
    response = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Sidecar-Token': token,
        ...(init.headers ?? {})
      }
    })
  } catch (cause) {
    throw new ApiError('UPSTREAM_UNAVAILABLE', 'The local service is not responding.', '', 0)
  }

  if (!response.ok) {
    // FastAPI wraps HTTPException payloads in `detail`.
    interface ErrorBody {
      code?: string
      message?: string
      hint?: string
    }
    const body = (await response.json().catch(() => null)) as
      | (ErrorBody & { detail?: ErrorBody })
      | null
    const detail: ErrorBody = body?.detail ?? body ?? {}
    throw new ApiError(
      (detail.code as ApiErrorCode) ?? 'UNKNOWN',
      detail.message ?? `Request failed with ${response.status}`,
      detail.hint ?? '',
      response.status
    )
  }

  return (await response.json()) as T
}

export const api = {
  login: (cookies: Record<string, string>): Promise<AuthResult> =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(cookies) }),

  authStatus: (): Promise<AuthResult> => request('/auth/status'),

  logout: (): Promise<{ ok: boolean }> => request('/auth/logout', { method: 'POST' }),

  agents: (): Promise<Agent[]> => request('/agents'),

  agentDetail: (id: number): Promise<AgentDetail> => request(`/agents/${id}`),

  analysis: (): Promise<Analysis> => request('/analysis'),

  /** S-rank agents and pulls each took, from the local pull log. */
  pulls: (): Promise<PullHistory> => request('/pulls'),

  engine: (name: string): Promise<EngineDetail> =>
    request(`/engines?name=${encodeURIComponent(name)}`),

  discSet: (name: string): Promise<DiscSetDetail> =>
    request(`/disc-sets?name=${encodeURIComponent(name)}`),

  /** Every set the catalog knows, each with a short ranked "who it's for"
   *  preview — the Disks tab's grid, and also the farming-goal picker's
   *  autocomplete source (it wants the same name+icon pairs). */
  discSetsOverview: (): Promise<DiscSetOverview[]> => request('/disc-sets/overview'),

  /** One entry per name, in the order given, so a team reads left to right. */
  synergy: (names: string[]): Promise<AgentSynergy[]> =>
    request(`/synergy?${names.map((n) => `names=${encodeURIComponent(n)}`).join('&')}`),

  startSync: (force = false): Promise<SyncStatus> =>
    request(`/sync?force=${force ? 'true' : 'false'}`, { method: 'POST' }),

  syncStatus: (): Promise<SyncStatus> => request('/sync/status'),

  cancelSync: (): Promise<SyncStatus> => request('/sync/cancel', { method: 'POST' })
}
