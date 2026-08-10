import { MemoryRouter } from 'react-router-dom'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialFeed } from './SocialFeed'

const socialMocks = vi.hoisted(() => ({
  loadPostsForAuthors: vi.fn(),
  loadNewsFeed: vi.fn(),
  updatePostComment: vi.fn(),
}))

vi.mock('@/lib/social', () => ({
  MAX_COMMENT_LENGTH: 1000,
  MAX_POST_LENGTH: 3000,
  activityTargetName: () => 'a player',
  createPost: vi.fn(),
  createPostComment: vi.fn(),
  deletePost: vi.fn(),
  loadNewsFeed: socialMocks.loadNewsFeed,
  loadPostsForAuthors: socialMocks.loadPostsForAuthors,
  setPostLiked: vi.fn(),
  updatePostComment: socialMocks.updatePostComment,
}))

const viewer = {
  id: 'viewer',
  username: 'PatternAfterError',
  avatar_url: null,
  power_level: 300,
  equipped_tag_text: null,
  equipped_tag_rarity: null,
}

const otherPlayer = {
  id: 'other',
  username: 'OtherPlayer',
  avatar_url: null,
  power_level: 200,
  equipped_tag_text: null,
  equipped_tag_rarity: null,
}

function postFixture() {
  return {
    id: 'post-1',
    user_id: 'post-author',
    body: 'Get ready for greatness!',
    created_at: '2026-08-09T12:00:00.000Z',
    updated_at: '2026-08-09T12:00:00.000Z',
    author: { ...otherPlayer, id: 'post-author', username: 'fleeboyjetson' },
    likeCount: 1,
    likedByViewer: false,
    comments: [
      {
        id: 'mine',
        post_id: 'post-1',
        user_id: viewer.id,
        body: 'Ahh yeah',
        created_at: '2026-08-09T12:01:00.000Z',
        author: viewer,
      },
      {
        id: 'theirs',
        post_id: 'post-1',
        user_id: otherPlayer.id,
        body: 'Welcome!',
        created_at: '2026-08-09T12:02:00.000Z',
        author: otherPlayer,
      },
    ],
  }
}

let renderer: TestRenderer.ReactTestRenderer | null = null

async function mount(): Promise<TestRenderer.ReactTestRenderer> {
  await act(async () => {
    renderer = TestRenderer.create(
      <MemoryRouter>
        <SocialFeed mode="wall" viewerId={viewer.id} profileId="post-author" />
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
  return renderer!
}

async function mountFeed(): Promise<TestRenderer.ReactTestRenderer> {
  await act(async () => {
    renderer = TestRenderer.create(
      <MemoryRouter>
        <SocialFeed mode="feed" viewerId={viewer.id} composerProfile={viewer} />
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
  return renderer!
}

function buttonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.findAllByType('button').find((button) => button.props.children === text)!
}

beforeEach(() => {
  socialMocks.loadPostsForAuthors.mockResolvedValue([postFixture()])
  socialMocks.loadNewsFeed.mockResolvedValue({
    audience: { userIds: [], followingCount: 0, clanmateCount: 0 },
    posts: [],
    activities: [],
  })
  socialMocks.updatePostComment.mockImplementation(async (id: string, userId: string, body: string) => ({
    ...postFixture().comments[0],
    id,
    user_id: userId,
    body: body.trim(),
  }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount())
    renderer = null
  }
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('profile wall comment editing', () => {
  it('offers report controls for another player\'s post and comment, but not the viewer\'s own comment', async () => {
    const mounted = await mount()
    expect(mounted.root.findAllByProps({ 'aria-label': 'Report content' })).toHaveLength(2)
  })

  it('shows Edit only on the viewer\'s comment and saves the inline edit', async () => {
    const mounted = await mount()
    const editButtons = mounted.root.findAllByProps({ 'aria-label': 'Edit your comment' })
    expect(editButtons).toHaveLength(1)

    await act(async () => editButtons[0].props.onClick())
    const editor = mounted.root.findByProps({ 'aria-label': 'Edit comment text' })
    expect(editor.props.value).toBe('Ahh yeah')

    await act(async () => editor.props.onChange({ target: { value: 'Ahh yeah!!' } }))
    const save = buttonByText(mounted.root, 'Save comment')
    const form = save.parent!.parent!
    await act(async () => {
      await form.props.onSubmit({ preventDefault: vi.fn() })
    })

    expect(socialMocks.updatePostComment).toHaveBeenCalledWith('mine', viewer.id, 'Ahh yeah!!')
    expect(JSON.stringify(mounted.toJSON())).toContain('Ahh yeah!!')
    expect(mounted.root.findAllByProps({ 'aria-label': 'Edit your comment' })).toHaveLength(1)
  })

  it('does not expose an edit action when the viewer owns none of the comments', async () => {
    socialMocks.loadPostsForAuthors.mockResolvedValue([
      { ...postFixture(), comments: [postFixture().comments[1]] },
    ])
    const mounted = await mount()
    expect(mounted.root.findAllByProps({ 'aria-label': 'Edit your comment' })).toHaveLength(0)
  })
})

describe('news feed composer', () => {
  it('lets the signed-in viewer choose a picture before posting', async () => {
    const mounted = await mountFeed()
    expect(mounted.root.findAllByProps({ 'aria-label': 'Choose a picture for your post' })).toHaveLength(1)
    expect(mounted.root.findAllByProps({ 'aria-label': 'Add a picture to your post' })).toHaveLength(1)
  })
})
