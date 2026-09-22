/**
 * Teams tab, with two sub-tabs:
 *
 *  - My Teams   — recommended comps every member of which you own.
 *  - Suggested  — comps you are missing pieces of, nearest-first, plus the
 *                 farming priorities derived from the same join.
 */

import { useState } from 'react'
import { EmptyState, InkMeter, Panel, SpeechBubble } from '../components/ComicBits'
import type { Analysis, TeamMember, TeamStatus } from '../types'
import './TeamsTab.css'

type SubTab = 'mine' | 'suggested'

interface Props {
  analysis: Analysis | null
  loading: boolean
}

export function TeamsTab({ analysis, loading }: Props): React.JSX.Element {
  const [sub, setSub] = useState<SubTab>('mine')

  const mine = analysis?.my_teams ?? []
  const suggested = analysis?.suggested_teams ?? []
  const farming = analysis?.farming ?? []

  return (
    <div className="teams">
      <div className="teams-subtabs" role="tablist" aria-label="Teams view">
        <button
          type="button"
          role="tab"
          aria-selected={sub === 'mine'}
          className={`ink-button ink-button-quiet ${sub === 'mine' ? 'is-active' : ''}`}
          onClick={() => setSub('mine')}
        >
          My Teams ({mine.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sub === 'suggested'}
          className={`ink-button ink-button-quiet ${sub === 'suggested' ? 'is-active' : ''}`}
          onClick={() => setSub('suggested')}
        >
          Suggested ({suggested.length})
        </button>
      </div>

      <div className="teams-body">
        {sub === 'mine' ? (
          mine.length === 0 ? (
            <EmptyState title={loading ? 'Crunching…' : 'No full teams yet'}>
              {loading
                ? 'Joining your roster with the recommendations.'
                : 'Once you own every member of a recommended comp, it shows up here.'}
            </EmptyState>
          ) : (
            <div className="teams-grid">
              {mine.map((team, index) => (
                <TeamCard key={team.team.agent_names.join('|')} team={team} index={index} />
              ))}
            </div>
          )
        ) : (
          <div className="teams-suggested">
            {farming.length > 0 && (
              <Panel tilt="right" className="teams-farming">
                <h3 className="display teams-farming-title">Farm next</h3>
                <ol className="teams-farming-list">
                  {farming.map((priority) => (
                    <li key={priority.label}>
                      <strong>{priority.label}</strong>
                      <span className="teams-farming-reason">{priority.reason}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}

            {suggested.length === 0 ? (
              <EmptyState title={loading ? 'Crunching…' : 'Nothing to suggest yet'}>
                Run a sync to pull recommendations.
              </EmptyState>
            ) : (
              <div className="teams-grid">
                {suggested.map((team, index) => (
                  <TeamCard key={team.team.agent_names.join('|')} team={team} index={index} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TeamCard({ team, index }: { team: TeamStatus; index: number }): React.JSX.Element {
  const missing = team.missing_members.length
  const owned = new Set(team.owned_members)

  // Prefer the parsed members (they carry portraits); fall back to bare names
  // if a guide predates the icons being captured.
  const roster: TeamMember[] =
    team.team.members.length > 0
      ? team.team.members
      : team.team.agent_names.map((name) => ({ name, icon: '', slug: '' }))

  return (
    <Panel tilt={index % 2 === 0 ? 'left' : 'right'} className="team-card">
      <header className="team-card-head">
        <h3 className="display team-card-title">{team.team.agent_names.join('  ·  ')}</h3>
        {team.fieldable ? (
          <span className="team-chip team-chip-ready">Ready</span>
        ) : (
          <span className="team-chip team-chip-missing">{missing} missing</span>
        )}
      </header>

      {team.team.note !== '' && <p className="team-card-note">{team.team.note}</p>}

      <ul className="team-portraits">
        {roster.map((member, slot) => {
          const isOwned = owned.has(member.name)
          return (
            <li
              key={`${member.name}-${slot}`}
              className={`team-portrait ${isOwned ? 'is-owned' : 'is-missing'}`}
              title={isOwned ? member.name : `${member.name} — not owned`}
            >
              <span className="team-portrait-art">
                {member.icon !== '' ? (
                  <img src={member.icon} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="team-portrait-initials display">{member.name.slice(0, 2)}</span>
                )}
              </span>
              <span className="team-portrait-name">{member.name}</span>
            </li>
          )
        })}
      </ul>

      {team.fieldable && (
        <div className="team-card-readiness">
          <span className="team-card-label">Build readiness</span>
          <InkMeter
            value={team.readiness}
            tone={team.readiness > 0.8 ? 'good' : team.readiness > 0.5 ? 'pow' : 'warn'}
          />
        </div>
      )}

      {!team.fieldable && missing === 1 && (
        <SpeechBubble>One agent away — {team.missing_members[0]} unlocks this comp.</SpeechBubble>
      )}
    </Panel>
  )
}
