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
