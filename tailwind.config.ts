import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette (matches the prototype — warm, hopeful, not corporate)
        brand: {
          50: '#EEF0FF',
          100: '#E0E5FF',
          500: '#5B6CFF',
          600: '#4451E8',
          700: '#3743C8',
          900: '#1F2680',
        },
        accent: {
          50: '#FDE6D3',
          500: '#F8A170',
          600: '#E58957',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F4F1EB',
          page: '#FAF8F4',
        },
        ink: {
          DEFAULT: '#1C2230',
          soft: '#5B6477',
          mute: '#8A93A6',
        },
        line: '#ECE7DD',
        success: { DEFAULT: '#2FB66A', soft: '#DDF4E7' },
        warn: { DEFAULT: '#E8A33D', soft: '#FDF0D5' },
        danger: { DEFAULT: '#E14B5A', soft: '#FDE2E4' },
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '14px',
      },
      boxShadow: {
        card: '0 6px 24px rgba(30, 35, 60, 0.06)',
        lg: '0 12px 40px rgba(30, 35, 60, 0.08)',
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
