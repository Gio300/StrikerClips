/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          DEFAULT: '#07070a',
          card: '#111116',
          border: '#292930',
          elevated: '#18181f',
        },
        accent: {
          DEFAULT: '#2ed3dc',
          muted: '#1fa5ad',
          glow: 'rgba(46, 211, 220, 0.24)',
        },
        kunai: {
          DEFAULT: '#ff5b3d',
          dark: '#d83e26',
          glow: 'rgba(255, 91, 61, 0.28)',
        },
        chakra: {
          DEFAULT: '#ffb224',
          dark: '#c77b00',
        },
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
        glow: '0 0 0 1px rgba(46, 211, 220, 0.22)',
        'glow-lg': '0 12px 36px rgba(0, 0, 0, 0.32)',
        kunai: '0 0 0 1px rgba(255, 91, 61, 0.2)',
        'kunai-lg': '0 12px 32px rgba(0, 0, 0, 0.32)',
        chakra: '0 0 0 1px rgba(255, 178, 36, 0.2)',
        trust: '0 0 0 1px rgba(90, 124, 255, 0.2)',
      },
      backgroundImage: {
        'gradient-kunai': 'linear-gradient(120deg, #ff5b3d 0%, #ff8a3d 100%)',
        'gradient-shinobi': 'linear-gradient(120deg, #2ed3dc 0%, #5a7cff 100%)',
        'gradient-mist': 'linear-gradient(180deg, rgba(255,91,61,0.06) 0%, rgba(7,7,10,0) 62%)',
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
