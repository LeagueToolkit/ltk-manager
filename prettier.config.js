/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
export default {
  plugins: ["prettier-plugin-tailwindcss"],
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "all",
  printWidth: 100,
  tailwindFunctions: ["clsx", "cn", "twMerge", "twJoin"],
  tailwindStylesheet: "./src/styles/tailwind.css",
};
