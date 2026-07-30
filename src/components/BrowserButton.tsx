import { useNavigate } from 'react-router-dom'

/**
 * Global floating "Browser" button — jump to the in-app browser (/browser) from
 * anywhere to pull up your console / socials and gather clips.
 *
 * Positioning: it shares VoiceButton's right rail and z-index (z-50, right-4)
 * but sits at bottom-24 so it stacks ABOVE the voice mic (bottom-6) — the two
 * 14×14 buttons never overlap. Slightly smaller and lower-opacity on small
 * screens so it stays out of the way on mobile.
 */
export function BrowserButton() {
  const navigate = useNavigate()

  return (
    <button
      aria-label="Open browser — jump to your apps"
      title="Open browser — jump to your apps"
      onClick={() => navigate('/browser')}
      className="fixed bottom-24 right-4 z-50 w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-glow flex items-center justify-center bg-gradient-kunai text-white transition-transform hover:scale-105 active:scale-95 opacity-90 sm:opacity-100"
    >
      {/* Globe / browser glyph */}
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
      </svg>
    </button>
  )
}
