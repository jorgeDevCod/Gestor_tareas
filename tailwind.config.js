/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // el toggle añade/quita .dark en <html> (initThemeToggle)
  content: [
    "./index.html",
    "./app.js",
    "./firebase-messaging-sw.js",
    "./*.html",
    "./src/**/*.js",
    "!./node_modules/**",
    "!./functions/node_modules/**",
    "!./dist/**"
  ],
  theme: {
    extend: {
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        }
      }
    },
  },
  plugins: [],
}
