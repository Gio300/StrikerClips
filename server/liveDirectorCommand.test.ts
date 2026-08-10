import { describe, expect, it } from 'vitest'
import {
  LIVE_DIRECTOR_CONTEXT_TARGET,
  coerceLiveDirectorIntent,
  parseLiveDirectorCommand,
} from './liveDirectorCommand'

describe('live director command parser', () => {
  it('adds named players or the currently selected person', () => {
    expect(parseLiveDirectorCommand('add Hammy to it')).toEqual({ action: 'add_players', targetNames: ['Hammy'] })
    expect(parseLiveDirectorCommand('add this person')).toEqual({
      action: 'add_players',
      targetNames: [LIVE_DIRECTOR_CONTEXT_TARGET],
    })
  })

  it('understands full-screen, multi-view, replay, and automatic direction', () => {
    expect(parseLiveDirectorCommand('put Kissa full screen')).toEqual({ action: 'focus_players', targetNames: ['Kissa'] })
    expect(parseLiveDirectorCommand('show Kissa and Hammy side by side')).toEqual({
      action: 'focus_players',
      targetNames: ['Kissa', 'Hammy'],
    })
    expect(parseLiveDirectorCommand('show all four cameras')).toEqual({ action: 'show_all' })
    expect(parseLiveDirectorCommand('replay the last 12 seconds')).toEqual({ action: 'replay', seconds: 12 })
    expect(parseLiveDirectorCommand('let TKO direct')).toEqual({ action: 'set_auto' })
  })

  it('requires a deliberate confirmation phrase to mark an end command confirmed', () => {
    expect(parseLiveDirectorCommand('stop the live')).toEqual({ action: 'end_show' })
    expect(parseLiveDirectorCommand('confirm end the show')).toEqual({ action: 'end_show', confirmed: true })
  })

  it('parses team names and validates model output', () => {
    expect(parseLiveDirectorCommand('the two teams are AI Clan vs Rival Squad')).toEqual({
      action: 'set_teams',
      teamA: 'AI Clan',
      teamB: 'Rival Squad',
    })
    expect(coerceLiveDirectorIntent({ action: 'focus_players', targetNames: [' Gio '], seconds: 99 })).toEqual({
      action: 'focus_players',
      targetNames: ['Gio'],
      youtubeUrl: undefined,
      label: undefined,
      teamA: undefined,
      teamB: undefined,
      seconds: 30,
      confirmed: false,
    })
    expect(coerceLiveDirectorIntent({ action: 'delete_database' })).toBeNull()
  })
})
