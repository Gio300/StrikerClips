/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          DEFAULT: '#0a0814',
          card: '#13111d',
          border: '#251f33',
          elevated: '#1a1726',
        },
        // Cyan kept as the original "accent" so the rest of the codebase keeps working.
        accent: {
          DEFAULT: '#00d4ff',
          muted: '#00a8cc',
          glow: 'rgba(0, 212, 255, 0.3)',
        },
        // New shinobi palette
        kunai: {
          DEFAULT: '#ef4444',
          dark: '#b91c1c',
          glow: 'rgba(239, 68, 68, 0.35)',
        },
        chakra: {
          DEFAULT: '#f59e0b',
          dark: '#b45309',
        },
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
        glow: '0 0 20px rgba(0, 212, 255, 0.2)',
        'glow-lg': '0 0 40px rgba(0, 212, 255, 0.25)',
        kunai: '0 0 24px rgba(239, 68, 68, 0.35)',
        'kunai-lg': '0 0 48px rgba(239, 68, 68, 0.4)',
        chakra: '0 0 24px rgba(245, 158, 11, 0.35)',
      },
      backgroundImage: {
        'gradient-kunai': 'linear-gradient(135deg, #ef4444 0%, #f59e0b 100%)',
        'gradient-shinobi': 'linear-gradient(135deg, #22c55e 0%, #ef4444 100%)',
        'gradient-mist': 'linear-gradient(180deg, rgba(239,68,68,0.12) 0%, rgba(10,8,20,0) 60%)',
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
