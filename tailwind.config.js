/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary brand scale — deep maroon. Used everywhere the app used to
        // reference "brand-*" (buttons, links, focus rings), so retheming here
        // recolors the whole app without touching every call site.
        brand: {
          50: '#fbeaec',
          100: '#f5d3d8',
          200: '#e6a7b0',
          300: '#d67a88',
          400: '#b94f60',
          500: '#932e3e',
          600: '#7a1f2e',
          700: '#611825',
          800: '#4a121c',
          900: '#340d14',
        },
        cream: {
          50: '#fdfbf5',
          100: '#faf3e2',
          200: '#f3e6c6',
          300: '#e9d5a3',
          400: '#dcbd76',
          500: '#cca94f',
        },
        gold: {
          300: '#ecd18a',
          400: '#dfb65b',
          500: '#c99a3a',
          600: '#a97c2a',
          700: '#8a6320',
        },
      },
      keyframes: {
        // Used by the attendance desk so each scan result visibly replaces the
        // last one — back-to-back students otherwise swap with no cue that
        // anything happened.
        'scan-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'scan-in': 'scan-in 200ms ease-out',
      },
    },
  },
  plugins: [],
}
