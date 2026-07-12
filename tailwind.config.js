/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Near-black KillCam surface (warm-neutral, not the old purple-black).
        dark: {
          DEFAULT: '#0A0A0C',
          card: '#141417',
          border: '#2A2A30',
          elevated: '#1A1A1F',
        },
        // Primary accent is now KillCam ORANGE (was cyan). This single change
        // re-tints every `accent` usage across the app.
        accent: {
          DEFAULT: '#FF7A18',
          muted: '#FF3B1F',
          glow: 'rgba(255, 122, 24, 0.3)',
        },
        // KillCam red / amber (kept the token names so existing markup restyles).
        kunai: {
          DEFAULT: '#FF3B1F',
          dark: '#C42A12',
          glow: 'rgba(255, 59, 31, 0.35)',
        },
        chakra: {
          DEFAULT: '#FFB800',
          dark: '#C78A00',
        },
        // Success green retained for "done/uploaded" states.
        leaf: {
          DEFAULT: '#22c55e',
          dark: '#15803d',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        brand: ['Orbitron', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 20px rgba(255, 122, 24, 0.22)',
        'glow-lg': '0 0 40px rgba(255, 122, 24, 0.28)',
        kunai: '0 0 24px rgba(255, 59, 31, 0.35)',
        'kunai-lg': '0 0 48px rgba(255, 59, 31, 0.42)',
        chakra: '0 0 24px rgba(255, 184, 0, 0.35)',
      },
      backgroundImage: {
        // KillCam signature: red → orange → amber.
        'gradient-kunai': 'linear-gradient(135deg, #FF3B1F 0%, #FF7A18 55%, #FFB800 100%)',
        'gradient-killcam': 'linear-gradient(135deg, #FF3B1F 0%, #FF7A18 55%, #FFB800 100%)',
        'gradient-shinobi': 'linear-gradient(135deg, #FF3B1F 0%, #FFB800 100%)',
        'gradient-mist': 'linear-gradient(180deg, rgba(255,59,31,0.12) 0%, rgba(10,10,12,0) 60%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
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
        pulseSoft: {
          '0%,100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
