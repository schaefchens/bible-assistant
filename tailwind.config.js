/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1a1a2e',
          deep: '#0f0f1e',
          soft: '#26263f',
        },
        gold: {
          DEFAULT: '#c8a96e',
          dim: '#9c8456',
          glow: '#e7c98a',
        },
        cream: {
          DEFAULT: '#e8e0d0',
          dim: '#bdb6a9',
        },
        ribbon: {
          gold: '#c8a96e',
          blue: '#7ab0d6',
          red: '#d57a7a',
          green: '#85bf9b',
          purple: '#a89dcf',
        },
        card: {
          'none-bg': '#2d2d49',
          'none-fg': '#e8e0d0',
          'yellow-bg': '#d4ba6b',
          'yellow-fg': '#1a1a2e',
          'amber-bg': '#cf9866',
          'amber-fg': '#1a1a2e',
          'coral-bg': '#d28a8a',
          'coral-fg': '#1a1a2e',
          'rose-bg': '#c98aaf',
          'rose-fg': '#1a1a2e',
          'lavender-bg': '#a89dcf',
          'lavender-fg': '#1a1a2e',
          'sage-bg': '#8fb29f',
          'sage-fg': '#1a1a2e',
          'sky-bg': '#88b3d8',
          'sky-fg': '#1a1a2e',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Georgia', 'Cambria', 'serif'],
      },
      animation: {
        'pulse-soft': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
