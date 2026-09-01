import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Only the dev server needs to know where the player is. The build does not:
// every request the app makes is a root-relative /api path, so once beefweb is
// serving the files it answers them itself, at whatever host and port it runs on.
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const target =
		process.env.BEEFWEB_URL || env.BEEFWEB_URL || "http://localhost:8880";

	return {
		plugins: [react()],

		// Relative asset paths, so a build works under whatever prefix beefweb
		// serves it from -- /, /jean, anything -- without rebuilding.
		base: "./",

		server: {
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
