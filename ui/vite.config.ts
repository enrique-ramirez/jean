import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { localePlugin, shippedLocales } from "./scripts/localePlugin.ts";

// A build needs no target at all: `foo_jean` serves Jean and answers `/api` from the one origin.
// Only the dev server, which serves Jean itself, has to be told where the player is.
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const target =
		process.env.FOO_JEAN_URL || env.FOO_JEAN_URL || "http://localhost:8881";

	return {
		define: {
			__SHIPPED_LOCALES__: JSON.stringify(shippedLocales(process.cwd())),
		},

		plugins: [react(), localePlugin()],

		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},

		base: "./",

		server: {
			port: 8123,
			// `foo_jean` matches the dev origin against an exact allowlist, so sliding to the
			// next free port would report the component unreachable with nothing saying why.
			strictPort: true,
			// Bind on the LAN too, so a phone can load the dev server directly.
			host: true,
			proxy: {
				// Same-origin during development: no CORS, and SSE streams through untouched.
				"/api": { target, changeOrigin: true },
			},
		},
	};
});
