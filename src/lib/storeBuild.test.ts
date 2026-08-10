import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mobileStoreBuildEnabled, storeBuildPolicy } from './storeBuild'

const SRC = join(__dirname, '..')
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8')

describe('mobile store build policy', () => {
  it('is enabled only by an explicit 1', () => {
    expect(mobileStoreBuildEnabled('1')).toBe(true)
    expect(mobileStoreBuildEnabled(' 1 ')).toBe(true)
    expect(mobileStoreBuildEnabled('0')).toBe(false)
    expect(mobileStoreBuildEnabled(undefined)).toBe(false)
    expect(mobileStoreBuildEnabled(true)).toBe(false)
  })

  it('fails closed for checkout, wagering, ad tech, push prompts, and sideloading', () => {
    expect(storeBuildPolicy('1')).toEqual({
      mobileStoreBuild: true,
      digitalCheckout: false,
      wageringUi: false,
      thirdPartyAdTech: false,
      sideloadUpdates: false,
      webPushPrompts: false,
      codeRedemption: false,
    })
  })

  it('does not change the normal web build', () => {
    expect(storeBuildPolicy(undefined)).toEqual({
      mobileStoreBuild: false,
      digitalCheckout: true,
      wageringUi: true,
      thirdPartyAdTech: true,
      sideloadUpdates: true,
      webPushPrompts: true,
      codeRedemption: true,
    })
  })
})

describe('store policy integration guards', () => {
  it('replaces every digital checkout route while retaining earned-collection access', () => {
    const app = read('App.tsx')
    for (const path of ['league-plans', 'store', 'shop', 'upgrade']) {
      expect(app, path).toMatch(new RegExp(`path=["']/?${path}["'][\\s\\S]{0,180}StoreUnavailable`))
    }
    expect(read('pages/StoreUnavailable.tsx')).toContain('to="/rewards"')
  })

  it('removes entitlement-code redemption from store builds', () => {
    expect(read('App.tsx')).toMatch(/path=["']redeem["'][\s\S]{0,180}StoreUnavailable/)
    for (const relative of [
      'components/BottomNav.tsx',
      'components/Sidebar.tsx',
      'pages/HomeMenu.tsx',
      'pages/Help.tsx',
      'pages/Rewards.tsx',
    ]) {
      expect(read(relative), relative).toContain('CODE_REDEMPTION_ENABLED')
    }
  })

  it('guards tips, tournament perk checkout, and every wagering surface', () => {
    expect(read('components/DonateButton.tsx')).toContain('DIGITAL_CHECKOUT_ENABLED')
    expect(read('components/tournament/TournamentRostersPanel.tsx')).toContain('DIGITAL_CHECKOUT_ENABLED && view')
    for (const relative of [
      'components/OracleBet.tsx',
      'components/OracleLivePanel.tsx',
      'components/WagerPanel.tsx',
      'components/TournamentPrizePoolPanel.tsx',
    ]) {
      expect(read(relative), relative).toContain('WAGERING_UI_ENABLED')
    }
  })

  it('blocks sideload delivery and third-party ad technology', () => {
    expect(read('hooks/useAppUpdate.ts')).toContain('SIDELOAD_UPDATES_ENABLED &&')
    expect(read('main.tsx')).toContain('THIRD_PARTY_AD_TECH_ENABLED && adsClient')
    expect(read('components/AdRollPixel.tsx')).toContain('if (!THIRD_PARTY_AD_TECH_ENABLED) return')
    expect(read('components/AdSlot.tsx')).toContain('THIRD_PARTY_AD_TECH_ENABLED &&')
  })
})
