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

		resolve: { tsconfigPaths: true },

		base: "./",

		server: {
			port: 8123,
			// Predictable, so a phone typing this address or a bookmark does not go looking
			// for whichever port happened to be free.
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
