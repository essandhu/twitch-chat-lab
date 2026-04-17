import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          950: '#0a0a0c',
          900: '#111114',
          800: '#18181c',
          700: '#24242a',
          500: '#4a4a53',
          300: '#a3a3ad',
          100: '#e7e7ea',
        },
        ember: {
          500: '#f5a524',
          400: '#f7b94d',
          600: '#d48f1a',
        },
        cobalt: {
          400: '#58a6ff',
        },
        sage: {
          400: '#7ee0a6',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
