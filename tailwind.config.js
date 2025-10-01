/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./app.min.js",
    "./app.js",
    "./**/*.html"
  ],
  theme: {
    extend: {
      // Tus colores personalizados si los necesitas
    },
  },
  plugins: [
    require( '@tailwindcss/forms' ),
    require( '@tailwindcss/typography' ),
    require( '@tailwindcss/aspect-ratio' )
  ],
}
