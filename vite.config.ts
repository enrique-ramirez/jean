import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Only the dev server needs to know where the player is. A build does not, with
// one exception: `foo_jean` listens on a port of its own, so its address is the
// page's host with a different port rather than a root-relative path. That is
// right when beefweb is serving the files and wrong on the dev server, which is
// on this machine -- so the host is injected here and read by `originOfPort`.
export default defineConfig(({ command, mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const target =
		process.env.BEEFWEB_URL || env.BEEFWEB_URL || "http://localhost:8880";

	// Null in a build: there, the page really is served by the player.
	const playerHost = command === "serve" ? new URL(target).hostname : null;

	return {
		define: { __PLAYER_HOST__: JSON.stringify(playerHost) },

		plugins: [react()],

		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},

		// Relative asset paths, so a build works under whatever prefix beefweb
		// serves it from -- /, /jean, anything -- without rebuilding.
		base: "./",

		server: {
			port: 8123,
			// `foo_jean` matches the dev origin against an exact allowlist, so
			// sliding to the next free port would report the component unreachable
			// with nothing on screen saying why. Fail instead.
			strictPort: true,
			// Bind on the LAN too, so a phone can load the dev server directly.
			host: true,
			proxy: {
				// Same-origin during development: no CORS, and beefweb needs no changes.
				// SSE streams through untouched.
				"/api": { target, changeOrigin: true },
			},
		},
	};
});
