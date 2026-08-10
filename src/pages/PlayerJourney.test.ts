import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { profileSectionLabel } from './Profile'
import { clanApplicationErrorMessage, clanCapacityLabel } from './ClanDiscovery'

const setup = readFileSync(join(__dirname, 'Setup.tsx'), 'utf8')
const settings = readFileSync(join(__dirname, 'Settings.tsx'), 'utf8')
const layout = readFileSync(join(__dirname, '..', 'components', 'Layout.tsx'), 'utf8')
const boards = readFileSync(join(__dirname, 'Boards.tsx'), 'utf8')
const discovery = readFileSync(join(__dirname, 'ClanDiscovery.tsx'), 'utf8')
const createClan = readFileSync(join(__dirname, 'CreateServer.tsx'), 'utf8')
const clanBoard = readFileSync(join(__dirname, 'BoardDetail.tsx'), 'utf8')
const signup = readFileSync(join(__dirname, 'Signup.tsx'), 'utf8')

describe('player journey labels and guidance', () => {
  it('gives every profile tab a distinct, honest label', () => {
    expect(profileSectionLabel('wall')).toBe('Wall')
    expect(profileSectionLabel('clips')).toBe('Clips')
    expect(profileSectionLabel('about')).toBe('About')
    expect(profileSectionLabel('stats')).toBe('Stats')
  })

  it('does not send a new phone user toward a sidebar or retired rankings flow', () => {
    expect(setup).not.toContain('button in the sidebar')
    expect(setup).not.toContain('climb the rankings')
    expect(setup).toContain('Tell me your gamer tag')
    expect(setup).toContain('whether you play solo or with a clan')
    expect(layout).not.toContain('<Onboarding />')
    expect(layout).not.toContain('<ConnectYouTubePrompt />')
  })

  it('turns application API codes into player-facing messages', () => {
    expect(clanApplicationErrorMessage('clan_is_full')).toBe('This clan is full.')
    expect(clanApplicationErrorMessage('already_a_clan_member')).toContain('already a member')
    expect(clanApplicationErrorMessage('unknown')).not.toContain('unknown')
  })

  it('keeps account creation short and leaves device notifications in settings', () => {
    expect(signup).toContain('Just the essentials')
    expect(signup).not.toContain('Turn on alerts')
    expect(signup).not.toContain('YouTube channel URL')
    expect(settings).toContain('<PushNotificationToggle />')
    expect(settings).toContain('Notifications')
    expect(settings).toContain('Continue setup with {display.assistantName}')
  })

  it('labels clan capacity as open spots plus current membership', () => {
    expect(clanCapacityLabel(0, 100)).toBe('100 open spots · 0/100 members')
    expect(clanCapacityLabel(100, 100)).toBe('0 open spots · 100/100 members')
  })

  it('lets a player exit clan creation before choosing a clan type', () => {
    expect(createClan).toContain('Back to clans')
    expect(createClan).toContain("navigate('/boards')")
  })

  it('does not leave a half-created clan behind when its default board setup fails', () => {
    expect(createClan).toContain('channelError || boardMemberError || clanMemberError')
    expect(createClan).toContain(".from('servers').delete().eq('id', server.id)")
    expect(createClan).toContain('Nothing was saved; please try again.')
    expect(clanBoard).toContain('No channels yet')
    expect(clanBoard).toContain('Create #general')
  })
})

describe('clan browsing at launch scale', () => {
  it('only loads clans, caps the first page, and exposes name search', () => {
    expect(boards).toContain(".eq('kind', 'clan')")
    expect(boards).toContain('.limit(50)')
    expect(boards).toContain('Search clans by name')
  })

  it('does not download every membership row just to count visible clans', () => {
    expect(discovery).toContain(".in('server_id', clanIds)")
    expect(discovery).toContain('.limit(50)')
    expect(discovery).toContain('Search clans by name')
  })
})
