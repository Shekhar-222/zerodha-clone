/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gain: "#00a862",
        loss: "#eb5b3c",
        accent: "#eb5b3c",
        link: "#387ed1",
      },
    },
  },
  plugins: [],
};
