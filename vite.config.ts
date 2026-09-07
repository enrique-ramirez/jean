import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { localePlugin, shippedLocales } from "./scripts/localePlugin.ts";

// Only the dev server needs to know where the player is. A build does not, except that
// `foo_jean` listens on a port of its own: its address is the page's host with a different
// port, which is right when beefweb serves the files and wrong on the dev server. The host is
// injected here and read by `originOfPort`.
export default defineConfig(({ command, mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const target =
		process.env.BEEFWEB_URL || env.BEEFWEB_URL || "http://localhost:8880";

	// Null in a build, where the page really is served by the player.
	const playerHost = command === "serve" ? new URL(target).hostname : null;

	return {
		define: {
			__PLAYER_HOST__: JSON.stringify(playerHost),
			__SHIPPED_LOCALES__: JSON.stringify(shippedLocales(process.cwd())),
		},

		plugins: [react(), localePlugin()],

		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},

		// Relative asset paths, so a build works under whatever prefix beefweb serves it from.
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
