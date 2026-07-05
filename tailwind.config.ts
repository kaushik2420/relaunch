import type { Config } from 'tailwindcss';

/**
 * Relaunch UI palette — remapped to match the Backyard SaaS parent
 * brand (forest greens + cream + sage accent). The class names
 * (`bg-brand-500`, `text-brand-700`, etc) stay the same across the
 * codebase; only the hex values change, so the whole UI picks up the
 * new scheme automatically.
 *
 * Reference — Backyard SaaS tokens:
 *   forest-900  #1A3826  (deep, plate colour + darkest text)
 *   forest-700  #2C5239  (mid forest — primary button hover)
 *   forest-500  #3F6E4D  (mid forest — primary button)
 *   forest-300  #7FA28C  (lighter tint for backgrounds)
 *   cream-50    #FAF5E9  (page background)
 *   cream-100   #F4ECD8  (muted section)
 *   cream-200   #E8DFC7  (subtle border / very light bg)
 *   accent      #C8DAC4  (sage — highlight underlines, chips)
 *   ink-900     #1C2220  (primary text)
 *   ink-600     #58665C  (secondary text)
 *   ink-400     #8C998F  (muted / captions)
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Primary brand → Backyard's forest greens.
        // Kept the 50/100/500/600/700/900 shape so every existing class
        // in the codebase (bg-brand-500, text-brand-700, etc) resolves.
        brand: {
          50: '#F4ECD8',   // cream-100 (very light tint — replaces the old #EEF0FF)
          100: '#E8DFC7',  // cream-200 (border-tint / chip bg)
          500: '#2C5239',  // mid forest — primary action colour
          600: '#1A3826',  // deep forest — hover state
          700: '#1A3826',  // deep forest — text emphasis
          900: '#143020',  // shade forest — deepest emphasis / borders
        },
        accent: {
          50: '#EEF3EE',   // very light sage
          500: '#C8DAC4',  // sage — subtle highlight (matches Backyard)
          600: '#A9BFA3',  // sage darker — hover on accent chips
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F4ECD8',  // cream-100 — muted section bg
          page: '#FAF5E9',   // cream-50 — page background
        },
        ink: {
          DEFAULT: '#1C2220',
          soft: '#58665C',
          mute: '#8C998F',
        },
        line: '#E8DFC7',    // cream-200 — soft border
        success: { DEFAULT: '#2FB66A', soft: '#DDF4E7' },
        warn: { DEFAULT: '#E8A33D', soft: '#FDF0D5' },
        danger: { DEFAULT: '#E14B5A', soft: '#FDE2E4' },

        // Extra tokens for direct use where we need explicit cream
        // shades independent of the brand scale. Referenced by some
        // components that used bg-cream-100 / bg-cream-50 directly.
        cream: {
          50: '#FAF5E9',
          100: '#F4ECD8',
          200: '#E8DFC7',
          300: '#D9CDAE',
        },
        forest: {
          300: '#7FA28C',
          500: '#3F6E4D',
          700: '#2C5239',
          900: '#1A3826',
        },
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '14px',
      },
      boxShadow: {
        card: '0 6px 24px rgba(26, 56, 38, 0.06)',
        lg: '0 12px 40px rgba(26, 56, 38, 0.10)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
