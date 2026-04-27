import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/", "agent/", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // New in eslint-plugin-react-hooks v6 (pulled in by eslint-config-next 16).
      // Flags fetch-on-mount setState patterns that are intentional in this app.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
