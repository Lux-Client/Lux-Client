/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--primary-color)',
        'primary-hover': 'var(--primary-hover-color)',
        background: 'var(--background-color)',
        'background-dark': 'var(--background-dark-color)',
        surface: 'var(--surface-color)',
      },
      borderRadius: {
        'xl': 'var(--border-radius)',
        '2xl': 'calc(var(--border-radius) * 1.5)',
      },
      fontFamily: {
        sans: ['var(--launcher-font)', 'sans-serif'],
      },
      boxShadow: {
        'primary-glow': '0 0 20px rgba(var(--primary-color-rgb), 0.3)',
      }
    },
  },
  plugins: [],
}
