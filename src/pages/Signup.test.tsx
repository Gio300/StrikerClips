import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Signup } from './Signup'

const signUp = vi.fn()
const getSession = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signUp: (...args: unknown[]) => signUp(...args), getSession: (...args: unknown[]) => getSession(...args) } },
}))
vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div>TKO.cam</div> }))
vi.mock('@/components/LegalFooter', () => ({ LegalLinks: () => <div>Legal links</div> }))

const mounted: TestRenderer.ReactTestRenderer[] = []

function SetupProbe() {
  const location = useLocation()
  return <div>{`SETUP${location.search}`}</div>
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child as ReactTestInstance)).join(' ')
}

beforeEach(() => {
  signUp.mockReset().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null })
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token' } } })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.unstubAllGlobals()
})

describe('account-first signup', () => {
  it('asks only for account essentials, then routes into chat setup', async () => {
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(
        <MemoryRouter initialEntries={[{ pathname: '/signup', state: { from: '/tournaments/abc' } }]}>
          <Routes>
            <Route path="/signup" element={<Signup />} />
            <Route path="/setup" element={<SetupProbe />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    mounted.push(renderer)

    const screen = text(renderer.root)
    expect(screen).toContain('Just the essentials')
    expect(screen).not.toContain('Username')
    expect(screen).not.toContain('YouTube')
    expect(screen).not.toContain('Notifications')

    const inputs = renderer.root.findAllByType('input')
    const email = inputs.find((input) => input.props.type === 'email')!
    const passwords = inputs.filter((input) => input.props.type === 'password')
    const checks = inputs.filter((input) => input.props.type === 'checkbox')
    await act(async () => {
      email.props.onChange({ target: { value: 'new@tko.cam' } })
      passwords[0].props.onChange({ target: { value: 'password123' } })
      passwords[1].props.onChange({ target: { value: 'password123' } })
      checks[0].props.onChange({ target: { checked: true } })
      checks[1].props.onChange({ target: { checked: true } })
    })
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))

    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@tko.cam',
      password: 'password123',
      options: { data: expect.objectContaining({ terms_accepted: true, privacy_accepted: true, age_consent_13_plus: true }) },
    }))
    const metadata = signUp.mock.calls[0][0].options.data
    expect(metadata).not.toHaveProperty('username')
    expect(metadata).not.toHaveProperty('youtube_url')
    expect(metadata).not.toHaveProperty('notifications_requested')
    expect(text(renderer.root)).toContain('SETUP?returnTo=%2Ftournaments%2Fabc')
  })

  it('keeps the existing-account sign-in link available but discreet', async () => {
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<MemoryRouter><Signup /></MemoryRouter>)
    })
    mounted.push(renderer)
    const signIn = renderer.root.findAllByType('a').find((link) => link.props.href === '/login')
    expect(signIn).toBeTruthy()
    expect(String(signIn!.props.className)).toContain('text-gray-300')
  })
})
