/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Roles, not hues. The app used to name these after the dark palette's
      // colours (navy / cream / gold), which stopped being true the moment a
      // light theme existed — `text-cream` rendering near-black is the kind of
      // thing that quietly wastes an afternoon. Values live in CSS variables so
      // a theme can swap them; see src/lib/themes.ts.
      colors: {
        surface: {
          DEFAULT: '#1a1a2e', // the page
          sunken: '#0f0f1e', // wells, insets, the deepest ground
          raised: '#26263f', // cards, inputs, anything lifted off the page
        },
        brand: {
          DEFAULT: '#c8a96e',
          muted: '#9c8456',
          bright: '#e7c98a', // hover / emphasis
        },
        ink: {
          DEFAULT: '#e8e0d0', // primary text
          muted: '#bdb6a9', // secondary text
        },
        // Foreground on a brand fill. Theme-dependent: the brand is light in the
        // dark theme (dark text on gold) and dark in the light theme (light text
        // on brown), so this has to invert with it.
        'on-brand': '#1a1a2e',
        // Foreground on a pastel ribbon or card fill. Fixed dark in *every*
        // theme, because those fills are light in every theme — which is exactly
        // why it can't share a token with 'on-brand'.
        'on-fill': '#1a1a2e',
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
