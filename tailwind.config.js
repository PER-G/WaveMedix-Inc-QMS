/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        wm: { dark: "#0F2B3C", teal: "#028090", green: "#10B981" }
      }
    }
  },
  plugins: [],
};
