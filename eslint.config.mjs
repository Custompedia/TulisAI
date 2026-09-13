import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  { rules: { "react-hooks/set-state-in-effect": "off", "react-hooks/refs": "off" } },
  { ignores: ["dist/**", ".wrangler/**", "node_modules/**", "worker-configuration.d.ts"] }
];

export default config;
