// Three things about `src/` that node does not know: `@/` is Vite's alias for
// `src/`, imports inside `src/` are written without an extension, and Vite's
// `define` substitutions are globals here rather than constants folded into the
// bundle. The e2e specs meet none of them -- they drive the built app over HTTP
// -- but a unit test importing a module from `src/` meets all three, so
// `pnpm test:unit` loads this first. Registered here rather than worked around
// by rewriting imports: the alias is a contribution rule, enforced by Biome per
// tier, and a module reaching for a fallback is a branch nothing ships.

import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

// The values `vite.config.ts` injects. No translation is fetched under `node`,
// so the shipped list is empty and English is the whole catalogue.
Object.assign(globalThis, { __PLAYER_HOST__: null, __SHIPPED_LOCALES__: [] });

registerHooks({
	resolve(specifier, context, next) {
		const aliased = specifier.startsWith("@/")
			? pathToFileURL(join(SRC, specifier.slice(2))).href
			: specifier;

		const relative = aliased.startsWith(".") || aliased.startsWith("file:");
		if (!relative || HAS_EXTENSION.test(aliased)) return next(aliased, context);

		// A component is `.tsx`; everything else in `src/` is `.ts`.
		try {
			return next(`${aliased}.ts`, context);
		} catch {
			return next(`${aliased}.tsx`, context);
		}
	},
});
