import { describe, it, expect } from 'vitest'
import { parseCommand } from './voiceCommands'

describe('parseCommand — navigation', () => {
  it('routes common destinations', () => {
    expect(parseCommand('go to rankings')).toMatchObject({ kind: 'navigate', path: '/profile' })
    expect(parseCommand('open browser')).toMatchObject({ kind: 'navigate', path: '/browser' })
    expect(parseCommand('show me reels')).toMatchObject({ kind: 'navigate', path: '/reels' })
    expect(parseCommand('tournaments')).toMatchObject({ kind: 'navigate', path: '/tournaments' })
    expect(parseCommand('take me home')).toMatchObject({ kind: 'navigate', path: '/' })
  })
})

describe('parseCommand — director', () => {
  it('all / single / focus', () => {
    expect(parseCommand('all screens')).toMatchObject({ kind: 'director', action: 'all' })
    expect(parseCommand('every angle')).toMatchObject({ kind: 'director', action: 'all' })
    expect(parseCommand('single screen')).toMatchObject({ kind: 'director', action: 'single' })
    expect(parseCommand('focus screen 2')).toMatchObject({ kind: 'director', action: 'focus', screen: 2 })
    expect(parseCommand('focus cam 4')).toMatchObject({ kind: 'director', action: 'focus', screen: 4 })
  })
  it('slow-mo / replay / go live', () => {
    expect(parseCommand('slow motion')).toMatchObject({ kind: 'director', action: 'slowmo' })
    expect(parseCommand('slowmo')).toMatchObject({ kind: 'director', action: 'slowmo' })
    expect(parseCommand('replay that kill')).toMatchObject({ kind: 'director', action: 'replay' })
    expect(parseCommand('run it back')).toMatchObject({ kind: 'director', action: 'replay' })
    expect(parseCommand("let's go live in the pit")).toMatchObject({ kind: 'director', action: 'golive' })
  })
})

describe('parseCommand — create', () => {
  it('detects category', () => {
    expect(parseCommand('make a clip of my kills')).toMatchObject({ kind: 'create', category: 'ko' })
    expect(parseCommand('make a clip of my k.o.s')).toMatchObject({ kind: 'create', category: 'ko' })
    expect(parseCommand('clip my ultimates')).toMatchObject({ kind: 'create', category: 'ultimate' })
    expect(parseCommand('cut my flag runs')).toMatchObject({ kind: 'create', category: 'flag' })
  })
})

describe('parseCommand — accessibility + fallback', () => {
  it('help / read / unknown', () => {
    expect(parseCommand('help')).toMatchObject({ kind: 'accessibility', action: 'help' })
    expect(parseCommand('what can i say')).toMatchObject({ kind: 'accessibility', action: 'help' })
    expect(parseCommand('read the screen')).toMatchObject({ kind: 'accessibility', action: 'read' })
    expect(parseCommand('asdf qwerty')).toMatchObject({ kind: 'unknown' })
    expect(parseCommand('')).toMatchObject({ kind: 'unknown' })
  })
})
