import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useChatDraft } from '@/hooks/useChatDraft'
import { useChatReactions } from '@/hooks/useChatReactions'
import {
  ChatRichText,
  EmojiPickerButton,
  MentionMenu,
  ReactionRow,
  ReplyButton,
  ReplyQuote,
  ReplyingToBar,
} from '@/components/chat'
import { prepareChatMessage, type ChatMention } from '@/lib/chatMentions'
import { replyPreview, resolveReplyTarget, type ReplyTarget } from '@/lib/chatReplies'

/**
 * StageChat — a compact, self-contained chat pane for surfaces that DON'T
 * have a Supabase `stream_id` to bind to (the client-side Live dashboard and
 * the synced reel stage). It mirrors StreamChat / TournamentChat's look and
 * feel — header, scrollback, log-in-gated composer — but keeps messages local
 * to the session so it works fully standalone with no backend.
 *
 * It consumes the SAME chat primitive as the persistent surfaces — mentions,
 * emoji, reactions and replies all behave identically here. The difference is
 * only where they live: nothing is written to a database, and the reaction hook
 * runs with `enabled: false`, so every interaction stays in React state. That
 * is exactly the degradation path the persistent surfaces take when a message
 * has no server row yet, so this pane exercises it by default.
 *
 * When a real stream id exists (Live multi-view, ProgramView, /watch), keep
 * using StreamChat; this is the lightweight sibling for the rest.
 */

type StageMessage = {
  id: string
  author: string
  authorId: string | null
  content: string
  mentions: ChatMention[]
  replyTo: string | null
  self: boolean
}

let _seq = 0

export function StageChat({
  title,
  className = '',
  heightClass = 'h-full',
}: {
  title?: string | null
  className?: string
  heightClass?: string
}) {
  const { user, profile } = useAuth()
  const [messages, setMessages] = useState<StageMessage[]>([])
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const draft = useChatDraft({ userId: user?.id ?? null })
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages])
  // enabled:false — this pane has no backing table, so reactions live and die
  // with the session. The hook's local-toggle path is the same one persistent
  // surfaces use for optimistic rows.
  const reactions = useChatReactions({
    surface: 'stream',
    messageIds,
    userId: user?.id ?? null,
    enabled: false,
  })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const outgoing = prepareChatMessage({ text: draft.text, mentions: draft.mentions })
    if (!outgoing.text) return
    const myName =
      profile?.username ??
      ((user?.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined) ??
      'you'
    setMessages((prev) => [
      ...prev,
      {
        id: `stage-${Date.now()}-${_seq++}`,
        author: myName,
        authorId: user?.id ?? null,
        content: outgoing.text,
        mentions: outgoing.mentions,
        replyTo: replyTo?.id ?? null,
        self: true,
      },
    ])
    draft.reset()
    setReplyTo(null)
  }

  function jumpToMessage(messageId: string) {
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div
      className={`flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden ${heightClass} ${className}`}
    >
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400 flex items-center justify-between">
        <span>Chat</span>
        {title && <span className="truncate text-gray-500 ml-2">{title}</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">
            Chat is live for this session. Say something.
          </p>
        ) : (
          messages.map((m) => {
            const parent = resolveReplyTarget(m.replyTo, messages, (row) => ({
              author: row.author,
              body: row.content,
              authorId: row.authorId,
            }))
            return (
              <div key={m.id} data-message-id={m.id} className="group leading-snug">
                {parent && <ReplyQuote target={parent} onJump={jumpToMessage} className="mb-0.5" />}
                <span className="text-accent font-semibold mr-1.5">{m.author}</span>
                <ChatRichText
                  text={m.content}
                  mentions={m.mentions}
                  viewerId={user?.id ?? null}
                  className="text-gray-200 break-words"
                />
                <ReplyButton
                  onClick={() =>
                    setReplyTo({
                      id: m.id,
                      author: m.author,
                      preview: replyPreview(m.content),
                      authorId: m.authorId,
                    })
                  }
                  className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                />
                <ReactionRow
                  tallies={reactions.talliesFor(m.id)}
                  onToggle={(emoji) => reactions.toggle(m.id, emoji)}
                  canReact={Boolean(user)}
                />
              </div>
            )
          })
        )}
      </div>
      {replyTo && <ReplyingToBar target={replyTo} onCancel={() => setReplyTo(null)} />}
      <form onSubmit={handleSend} className="relative border-t border-dark-border p-2 flex gap-2">
        <MentionMenu draft={draft} />
        <input
          ref={(el) => {
            draft.inputRef.current = el
          }}
          type="text"
          value={draft.text}
          onChange={draft.onChange}
          onKeyDown={draft.onKeyDown}
          onClick={draft.onCaretMove}
          onBlur={draft.onBlur}
          maxLength={500}
          placeholder="Say something — @mention or :fire:…"
          className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
        />
        <EmojiPickerButton
          onPick={draft.insertEmoji}
          className="shrink-0 [&>button]:h-[34px] [&>button]:w-[34px]"
        />
        <button
          type="submit"
          disabled={!draft.text.trim()}
          className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

export default StageChat
