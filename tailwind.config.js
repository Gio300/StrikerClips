/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // League-themable slots. Each resolves through a `--league-*` CSS
        // variable ("r g b" channel triplet) whose defaults — the stock TKO
        // palette (neutral navy v2, 2026-08-03) — live in src/index.css :root.
        // LeagueThemeProvider (src/lib/leagueTheme.ts) overrides them at runtime
        // to re-skin the whole app for a league. `leaf` and `trust` are semantic
        // (success / info) and intentionally NOT league-themable.
        dark: {
          DEFAULT: 'rgb(var(--league-dark) / <alpha-value>)',          // #1a2636
          card: 'rgb(var(--league-dark-card) / <alpha-value>)',        // #232f3e
          border: 'rgb(var(--league-dark-border) / <alpha-value>)',    // #384250
          elevated: 'rgb(var(--league-dark-elevated) / <alpha-value>)',// #2a3544
        },
        accent: {
          DEFAULT: 'rgb(var(--league-accent) / <alpha-value>)',        // #a8c3e1
          muted: 'rgb(var(--league-accent-muted) / <alpha-value>)',    // #869cb4
          glow: 'rgb(var(--league-accent) / 0.24)',
        },
        kunai: {
          DEFAULT: 'rgb(var(--league-kunai) / <alpha-value>)',         // #2b69e4
          dark: 'rgb(var(--league-kunai-dark) / <alpha-value>)',       // #2254b6
          glow: 'rgb(var(--league-kunai) / 0.28)',
        },
        chakra: {
          DEFAULT: 'rgb(var(--league-chakra) / <alpha-value>)',        // #40c094
          dark: 'rgb(var(--league-chakra-dark) / <alpha-value>)',      // #2d8668
        },
        // ".cam" wordmark ink (BrandLogo). Defaults to the kunai slot via
        // --brand-cam in index.css; the bright TKO boards/Studio override it
        // because their kunai is a CTA-plate tone, illegible as text there.
        cam: 'rgb(var(--brand-cam) / <alpha-value>)',
        // INK slots (palette v3, 2026-08-03). Before these every surface
        // hardcoded `text-white` / `text-gray-400`, which silently assumed a
        // DARK chrome — so the moment TKO's own board went LIGHT the copy
        // rendered white-on-white. `text-ink` / `text-ink-muted` follow the
        // active surface instead: leagueThemeVars derives the pair from the
        // league background's luminance, so one markup reads on either family.
        ink: {
          DEFAULT: 'rgb(var(--league-ink) / <alpha-value>)',       // #16202e light · #f3f4f6 dark
          muted: 'rgb(var(--league-ink-muted) / <alpha-value>)',   // #565f6e light · #cbd5e1 dark
        },
        // Label ink on a FILLED kunai CTA — white on every palette we ship,
        // but derived so a pastel league brand can't produce a white-on-white
        // button (see leagueThemeVars).
        'on-primary': 'rgb(var(--league-on-primary) / <alpha-value>)',
        leaf: {
          DEFAULT: '#2ccb7f',
          dark: '#178b54',
        },
        trust: {
          DEFAULT: '#5a7cff',
          dark: '#3655cf',
          glow: 'rgba(90, 124, 255, 0.28)',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        brand: ['Orbitron', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--league-accent) / 0.22)',
        'glow-lg': '0 12px 36px rgba(0, 0, 0, 0.32)',
        kunai: '0 0 0 1px rgb(var(--league-kunai) / 0.2)',
        'kunai-lg': '0 12px 32px rgba(0, 0, 0, 0.32)',
        chakra: '0 0 0 1px rgb(var(--league-chakra) / 0.2)',
        trust: '0 0 0 1px rgba(90, 124, 255, 0.2)',
      },
      backgroundImage: {
        // --league-kunai-2 is the gradient companion (default #ff8a3d),
        // derived from the league primary by LeagueThemeProvider.
        'gradient-kunai': 'linear-gradient(120deg, rgb(var(--league-kunai)) 0%, rgb(var(--league-kunai-2)) 100%)',
        'gradient-shinobi': 'linear-gradient(120deg, rgb(var(--league-accent)) 0%, #5a7cff 100%)',
        'gradient-mist': 'linear-gradient(180deg, rgb(var(--league-kunai) / 0.06) 0%, rgb(var(--league-dark) / 0) 62%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
