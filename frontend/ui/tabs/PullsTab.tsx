/**
 * Pulls tab: one tile per Signal Search channel; opening a tile shows that
 * channel's pity and luck, and every S-rank it gave and how many pulls it took.
 *
 * The data is the local pull log the sidecar keeps (see services/pulls.py).
 * It is fetched from HoYoLAB on Sync, never leaves this machine, and is never
 * compared against other players — every figure here is this account's own.
 */

import { useMemo, useState } from 'react'
import encryptedTapeArt from '@resources/Item_Encrypted_Master_Tape.png'
import masterTapeArt from '@resources/Item_Master_Tape.png'
import booponArt from '@resources/Item_Boopon.png'
import exclusiveBanner from '@resources/exclusive.webp'
import stableBanner from '@resources/stable.webp'
import bangbooBanner from '@resources/bangboo.webp'
import { EmptyState, Portrait, RankBadge, Tech } from '../components/Ui'
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

// --- channel tiles (overview) ------------------------------------------------------

const CHANNEL_NAME: Record<string, string> = {
  exclusive: 'Exclusive Channel',
  wengine: 'W-Engine Channel',
  standard: 'Stable Channel',
  bangboo: 'Bangboo Channel'
}

/**
 * Official HoYoverse wallpapers, used as channel-tile banners under the ZZZ
 * Fan Creations Guide (non-commercial fan use; see the README's legal
 * statement). `focus` is the object-position that keeps faces in frame when
 * the 16:9 wallpaper is cropped to the 2:1 tile. W-Engine has none, so it
 * shows The Brimstone instead.
 */
const CHANNEL_BANNER: Record<string, { src: string; focus: string }> = {
  exclusive: { src: exclusiveBanner, focus: '50% 30%' },
  standard: { src: stableBanner, focus: '50% 28%' },
  bangboo: { src: bangbooBanner, focus: '50% 38%' }
}

/** Which banners each channel folds in, since pity is shared across them. */
const CHANNEL_NOTE: Record<string, string> = {
  exclusive: 'Includes Exclusive Rescreening, which shares its pity.',
  wengine: 'Includes W-Engine Reverberation, which shares its pity.'
}

type ThumbKind = 'banner' | 'portrait' | 'item'

function ChannelTile({
  stats,
  thumb,
  kind,
  focus,
  onOpen
}: {
  stats: PoolStats
  thumb: string
  /** Wallpaper / agent portrait are cropped to fill; an item icon is shown whole. */
  kind: ThumbKind
  /** object-position for cropped art. */
  focus?: string
  onOpen: () => void
}): React.JSX.Element {
  const limited = stats.pool === 'exclusive' || stats.pool === 'wengine'
  const currency = POOL_CURRENCY[stats.pool] ?? encryptedTapeArt
  const name = CHANNEL_NAME[stats.pool] ?? stats.pool

  const summary =
    stats.total_pulls === 0
      ? 'No pulls on record'
      : stats.s_count === 0
        ? 'No S-ranks yet'
        : `${stats.s_count} S-rank${stats.s_count === 1 ? '' : 's'}` +
          (stats.average_s !== null ? ` · ${stats.average_s} avg` : '') +
          (limited ? (stats.guaranteed ? ' · Next is guaranteed' : ' · Next is 50/50') : '')

  return (
    <button type="button" className="chan-tile" onClick={onOpen} aria-label={`${name}: view details`}>
      <span className={`chan-thumb is-${kind}`}>
        <img
          src={thumb || currency}
          alt=""
          draggable={false}
          loading="lazy"
          style={focus !== undefined ? { objectPosition: focus } : undefined}
        />
        <span className="chan-thumb-scrim" aria-hidden="true" />
        <span className="chan-counters">
          <span className="chan-counter" title="Total pulls">
            <img className="chan-currency" src={currency} alt="" draggable={false} />
            {stats.total_pulls.toLocaleString()}
          </span>
          <span className="chan-counter is-s" title="S-Rank pity">
            <RankBadge rank="S" size={26} />
            {stats.since_last_s}/{stats.hard_pity}
          </span>
          <span className="chan-counter is-a" title="A-Rank pity">
            <RankBadge rank="A" size={26} />
            {stats.since_last_a}/10
          </span>
        </span>
      </span>
      <span className="chan-body">
        <span className="display chan-name">{name}</span>
        <span className="chan-summary">{summary}</span>
        <span className="chan-cta">View details</span>
      </span>
    </button>
  )
}

// --- channel detail ---------------------------------------------------------------

function ChannelDetail({
  stats,
  pulls,
  byId,
  byName,
  onBack
}: {
  stats: PoolStats
  /** This pool's S-ranks, newest first. */
  pulls: SRankPull[]
  byId: Map<number, Agent>
  byName: Map<string, Agent>
  onBack: () => void
}): React.JSX.Element {
  const name = CHANNEL_NAME[stats.pool] ?? stats.pool
  return (
    <div className="pulls-scroll">
      <div className="pulls-bar">
        <button type="button" className="btn pulls-back" onClick={onBack}>
          ← Channels
        </button>
        <h2 className="display pulls-title">{name}</h2>
        {CHANNEL_NOTE[stats.pool] !== undefined && (
          <Tech className="pulls-note">{CHANNEL_NOTE[stats.pool]}</Tech>
        )}
      </div>

      <div className="chan-detail">
        <ChannelCard stats={stats} history={pulls.slice().reverse()} />

        <div className="chan-history">
          <h3 className="display pulls-subtitle">S-Rank History</h3>
          {pulls.length === 0 ? (
            <EmptyState title="No S-ranks yet">
              {stats.total_pulls > 0
                ? `${stats.total_pulls} pulls on record in this channel, none of them an S-rank so far.`
                : 'No pulls on record in this channel. Press Sync to fetch them.'}
            </EmptyState>
          ) : (
            <ul className="pulls-grid">
              {pulls.map((pull) => (
                <PullCard
                  key={pull.id}
                  pull={pull}
                  hardPity={stats.hard_pity}
                  agent={byId.get(pull.item_id) ?? byName.get(pull.name.trim().toLowerCase())}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// --- tab ------------------------------------------------------------------------

export function PullsTab({ pulls, agents, loading }: Props): React.JSX.Element {
  const [openPool, setOpenPool] = useState<string | null>(null)

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

  const open = pulls.pools.find((p) => p.pool === openPool)
  if (open !== undefined) {
    return (
      <div className="pulls">
        <ChannelDetail
          stats={open}
          pulls={pulls.s_ranks.filter((s) => s.pool === open.pool)}
          byId={byId}
          byName={byName}
          onBack={() => setOpenPool(null)}
        />
      </div>
    )
  }

  // Bundled official wallpapers first. W-Engine has none and uses The
  // Brimstone's art from the sidecar; failing that, an agent channel falls
  // back to Ellen's portrait and an item channel to its currency icon.
  const ellen = byName.get('ellen')
  const ellenArt = ellen?.card_icon || ellen?.square_icon || ''
  const thumbFor = (pool: string): { src: string; kind: ThumbKind; focus?: string } => {
    const banner = CHANNEL_BANNER[pool]
    if (banner !== undefined) return { src: banner.src, kind: 'banner', focus: banner.focus }
    if (pool === 'exclusive' || pool === 'standard') {
      return { src: ellenArt, kind: ellenArt !== '' ? 'portrait' : 'item' }
    }
    return { src: pulls.art[pool] ?? '', kind: 'item' }
  }

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

        {pulls.total_pulls === 0 && (
          <p className="pulls-hint">
            No pull history yet. Press Sync to fetch your Signal Search history from HoYoLAB. It
            is stored only on this computer.
          </p>
        )}

        <div className="chan-grid">
          {pulls.pools.map((stats) => {
            const thumb = thumbFor(stats.pool)
            return (
              <ChannelTile
                key={stats.pool}
                stats={stats}
                thumb={thumb.src}
                kind={thumb.kind}
                focus={thumb.focus}
                onOpen={() => setOpenPool(stats.pool)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
