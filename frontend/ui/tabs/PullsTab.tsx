/**
 * Pulls tab: per-channel pity and luck, then every S-rank obtained and how
 * many pulls it took.
 *
 * The data is the local pull log the sidecar keeps (see services/pulls.py).
 * It is fetched from HoYoLAB on Sync, never leaves this machine, and is never
 * compared against other players — every figure here is this account's own.
 */

import { useMemo, useState } from 'react'
import encryptedTapeArt from '@resources/Item_Encrypted_Master_Tape.png'
import masterTapeArt from '@resources/Item_Master_Tape.png'
import booponArt from '@resources/Item_Boopon.png'
import { EmptyState, Portrait, Tech } from '../components/Ui'
import type { Agent, PoolStats, PullHistory, SRankPull } from '../types'
import './PullsTab.css'

interface Props {
  pulls: PullHistory | null
  agents: Agent[]
  loading: boolean
}

const POOL_LABEL: Record<string, string> = {
  exclusive: 'Exclusive',
  wengine: 'W-Engine',
  standard: 'Stable',
  bangboo: 'Bangboo'
}

/** What each channel spends: the Stable Channel takes plain Master Tapes,
 *  the Bangboo Channel Boopons, and the limited ones Encrypted Master Tapes. */
const POOL_CURRENCY: Record<string, string> = {
  standard: masterTapeArt,
  bangboo: booponArt
}

const RESULT_LABEL: Record<string, string> = {
  won: 'Won 50/50',
  lost: 'Lost 50/50',
  guaranteed: 'Guaranteed'
}

/** Soft-pity-ish thresholds, relative to the pool's hard pity. They only pick
 *  a colour; the number itself is always shown. */
function luckTone(pulls: number, hardPity: number): string {
  if (pulls <= hardPity * 0.56) return 'is-lucky'
  if (pulls >= hardPity * 0.84) return 'is-unlucky'
  return ''
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}

// --- channel card ------------------------------------------------------------

function ChannelCard({
  stats,
  history
}: {
  stats: PoolStats
  /** This pool's S-ranks, oldest first. */
  history: SRankPull[]
}): React.JSX.Element {
  const limited = stats.pool === 'exclusive' || stats.pool === 'wengine'
  const flips = stats.fifty_won + stats.fifty_lost
  const fill = Math.min(1, stats.since_last_s / stats.hard_pity)

  return (
    <section className="channel" aria-label={`${POOL_LABEL[stats.pool] ?? stats.pool} channel`}>
      <header className="channel-head">
        <h3 className="display channel-name">{POOL_LABEL[stats.pool] ?? stats.pool}</h3>
        {limited && (
          <span className={`channel-flag ${stats.guaranteed ? 'is-guaranteed' : ''}`}>
            {stats.guaranteed ? 'Guaranteed' : '50/50'}
          </span>
        )}
      </header>

      <div className="channel-pity">
        <span className="display channel-pity-n">{stats.since_last_s}</span>
        <span className="channel-pity-of">/ {stats.hard_pity}</span>
        <Tech className="channel-pity-label">S-Rank pity</Tech>
        <span className="channel-a">
          <Tech>A-Rank pity</Tech> <b>{stats.since_last_a}</b>/10
        </span>
      </div>
      <div
        className="channel-meter"
        role="meter"
        aria-label="Pulls toward S-Rank hard pity"
        aria-valuemin={0}
        aria-valuemax={stats.hard_pity}
        aria-valuenow={stats.since_last_s}
      >
        <span className="channel-meter-fill" style={{ width: `${fill * 100}%` }} />
      </div>

      <dl className="channel-stats">
        <div>
          <dt>Pulls</dt>
          <dd>{stats.total_pulls.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Polychrome</dt>
          <dd>{stats.polychrome.toLocaleString()}</dd>
        </div>
        <div>
          <dt>S-ranks</dt>
          <dd>{stats.s_count}</dd>
        </div>
        <div>
          <dt>Avg / S</dt>
          <dd>{stats.average_s === null ? '—' : stats.average_s}</dd>
        </div>
        {limited && (
          <div className="channel-stat-wide">
            <dt>50/50 won</dt>
            <dd>
              {stats.fifty_won}/{flips} <span className="channel-rate">{percent(stats.fifty_won, flips)}</span>
            </dd>
          </div>
        )}
      </dl>

      {history.length > 0 && <PitySparkbars history={history} hardPity={stats.hard_pity} limited={limited} />}
    </section>
  )
}

/**
 * One bar per S-rank, oldest to newest, height = pulls it took against hard
 * pity. Colour is the 50/50 result, but never on its own: lost bars are also
 * hatched, every bar has a tooltip naming its result, and the legend spells
 * them out.
 */
function PitySparkbars({
  history,
  hardPity,
  limited
}: {
  history: SRankPull[]
  hardPity: number
  limited: boolean
}): React.JSX.Element {
  return (
    <figure className="spark">
      <div className="spark-plot" role="list" aria-label="Pulls per S-rank, oldest first">
        {history.map((pull) => {
          const label = [
            `${pull.name}: ${pull.pulls}${pull.partial ? '+' : ''} pulls`,
            RESULT_LABEL[pull.result],
            formatDate(pull.time)
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <span key={pull.id} className="spark-slot" role="listitem" title={label} aria-label={label}>
              <span
                className={`spark-bar result-${pull.result || 'none'}`}
                style={{ height: `${Math.max(6, Math.min(1, pull.pulls / hardPity) * 100)}%` }}
              />
            </span>
          )
        })}
      </div>
      {limited && (
        <figcaption className="spark-legend">
          <span className="spark-key result-won">Won</span>
          <span className="spark-key result-lost">Lost</span>
          <span className="spark-key result-guaranteed">Guaranteed</span>
        </figcaption>
      )}
    </figure>
  )
}

// --- history card -------------------------------------------------------------

function TapeCount({
  pulls,
  partial,
  hardPity,
  pool
}: {
  pulls: number
  partial: boolean
  hardPity: number
  pool: string
}): React.JSX.Element {
  return (
    <span
      className={`pull-count ${luckTone(pulls, hardPity)}`}
      title={
        partial
          ? 'No earlier S-rank on record in this channel, so pulls before the oldest record HoYoLAB returned may be missing.'
          : `${pulls} pulls`
      }
    >
      <img
        className="pull-tape"
        src={POOL_CURRENCY[pool] ?? encryptedTapeArt}
        alt=""
        draggable={false}
      />
      <span className="pull-x" aria-hidden="true">
        ×
      </span>
      <span className="display pull-n">
        {pulls}
        {partial ? '+' : ''}
      </span>
    </span>
  )
}

function PullCard({
  pull,
  agent,
  hardPity
}: {
  pull: SRankPull
  agent: Agent | undefined
  hardPity: number
}): React.JSX.Element {
  const isAgent = pull.kind === 'agent'
  return (
    <li className="pull-card">
      <TapeCount pulls={pull.pulls} partial={pull.partial} hardPity={hardPity} pool={pull.pool} />
      <div className={`pull-art ${isAgent ? '' : 'is-item'}`}>
        <Portrait
          src={isAgent ? (agent?.card_icon ?? '') : pull.icon}
          fallback={isAgent ? (agent?.square_icon ?? '') : ''}
          alt={pull.name}
          initials={pull.name.slice(0, 2)}
        />
        <span className="pull-scrim" aria-hidden="true" />
        {pull.result !== '' && (
          <span className={`pull-result result-${pull.result}`}>{RESULT_LABEL[pull.result]}</span>
        )}
        <span className="pull-strip">
          <span className="display pull-name">{pull.name}</span>
          <Tech>
            {POOL_LABEL[pull.pool] ?? pull.pool} · {formatDate(pull.time)}
          </Tech>
        </span>
      </div>
    </li>
  )
}

// --- tab ------------------------------------------------------------------------

export function PullsTab({ pulls, agents, loading }: Props): React.JSX.Element {
  const [filter, setFilter] = useState<string>('all')

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const byName = useMemo(
    () => new Map(agents.map((a) => [a.name.trim().toLowerCase(), a])),
    [agents]
  )

  if (pulls === null) {
    return (
      <div className="pulls">
        <EmptyState title={loading ? 'Loading pulls' : 'No pull data'} />
      </div>
    )
  }

  if (pulls.total_pulls === 0) {
    return (
      <div className="pulls">
        <EmptyState title="No pull history yet">
          Press Sync to fetch your Signal Search history from HoYoLAB. It is stored only on this
          computer.
        </EmptyState>
      </div>
    )
  }

  const activePools = pulls.pools.filter((p) => p.total_pulls > 0)
  const hardPity = new Map(pulls.pools.map((p) => [p.pool, p.hard_pity]))
  const poolsWithS = activePools.filter((p) => p.s_count > 0).map((p) => p.pool)
  const shown = filter === 'all' ? pulls.s_ranks : pulls.s_ranks.filter((s) => s.pool === filter)
  const polychrome = pulls.pools.reduce((sum, p) => sum + p.polychrome, 0)

  return (
    <div className="pulls">
      <div className="pulls-scroll">
        <div className="pulls-bar">
          <h2 className="display pulls-title">Signal Search</h2>
          <div className="pulls-stats">
            <span className="pulls-stat">
              <span className="display pulls-stat-n">{pulls.total_pulls.toLocaleString()}</span>
              <Tech>total pulls</Tech>
            </span>
            <span className="pulls-stat">
              <span className="display pulls-stat-n">{polychrome.toLocaleString()}</span>
              <Tech>polychrome</Tech>
            </span>
            <span className="pulls-stat">
              <span className="display pulls-stat-n">{pulls.s_ranks.length}</span>
              <Tech>S-ranks</Tech>
            </span>
          </div>
        </div>

        <div className="channels">
          {activePools.map((stats) => (
            <ChannelCard
              key={stats.pool}
              stats={stats}
              history={pulls.s_ranks.filter((s) => s.pool === stats.pool).slice().reverse()}
            />
          ))}
        </div>

        <div className="pulls-history-bar">
          <h3 className="display pulls-subtitle">S-Rank History</h3>
          {poolsWithS.length > 1 && (
            <div className="pulls-filters" role="tablist" aria-label="Channel">
              {['all', ...poolsWithS].map((pool) => (
                <button
                  key={pool}
                  type="button"
                  role="tab"
                  aria-selected={filter === pool}
                  className={`btn pulls-filter ${filter === pool ? 'btn-active' : ''}`}
                  onClick={() => setFilter(pool)}
                >
                  {pool === 'all' ? 'All' : (POOL_LABEL[pool] ?? pool)}
                </button>
              ))}
            </div>
          )}
        </div>

        {shown.length === 0 ? (
          <EmptyState title="No S-ranks yet">
            {pulls.total_pulls} pulls on record, none of them an S-rank so far.
          </EmptyState>
        ) : (
          <ul className="pulls-grid">
            {shown.map((pull) => (
              <PullCard
                key={pull.id}
                pull={pull}
                hardPity={hardPity.get(pull.pool) ?? 90}
                agent={byId.get(pull.item_id) ?? byName.get(pull.name.trim().toLowerCase())}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
