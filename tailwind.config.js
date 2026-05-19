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
