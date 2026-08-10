/**
 * The shared chat primitive: mentions, emoji, reactions and replies.
 * (ChatLiveBar and NewMessagesDivider are the live/unread layer and are
 * imported by path, not through this barrel.)
 *
 * Four surfaces consume these — StreamChat
 * (live/merged), TournamentChat, StageChat and the ChatComposer /
 * ChatMessageContent pair used by ChatSpace channels and DMs — so a mention, an
 * emoji, a reaction and a reply look and behave the same everywhere.
 *
 * The pure logic lives in src/lib/chatMentions.ts, chatEmoji.ts,
 * chatReactions.ts and chatReplies.ts; the state lives in
 * src/hooks/useChatDraft.ts and useChatReactions.ts. These components are the
 * thin presentation layer over both.
 */
export { ChatRichText } from './ChatRichText'
export { EmojiPickerButton } from './EmojiPickerButton'
export { MentionMenu } from './MentionMenu'
export { ReactionRow, ReplyButton, ReplyQuote, ReplyingToBar } from './MessageActions'
