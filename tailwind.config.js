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
        // `rgb(var(--x) / <alpha-value>)`, not a hex, so the 173 alpha modifiers
        // in this codebase (bg-brand/40 and friends) keep working. Values live
        // in src/index.css; see the comment there.
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)', // the page
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)', // wells, insets
          raised: 'rgb(var(--surface-raised) / <alpha-value>)', // cards, inputs
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          muted: 'rgb(var(--brand-muted) / <alpha-value>)',
          bright: 'rgb(var(--brand-bright) / <alpha-value>)', // more emphasis
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)', // primary text
          muted: 'rgb(var(--ink-muted) / <alpha-value>)', // secondary text
        },
        // Foreground on a brand fill. Theme-dependent: the brand is light in the
        // dark theme (dark text on gold) and dark in the light theme (light text
        // on brown), so this has to invert with it.
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',
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
          // Theme-dependent, unlike the rest of this palette: an uncoloured
          // card is chrome, so it follows the surface rather than staying a
          // fixed dark tile on a light page.
          'none-bg': 'rgb(var(--card-none-bg) / <alpha-value>)',
          'none-fg': 'rgb(var(--card-none-fg) / <alpha-value>)',
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
