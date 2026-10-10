import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const distDir = () =>
	process.env.JEAN_DIST
		? resolve(process.env.JEAN_DIST)
		: join(dirname(fileURLToPath(import.meta.url)), "../../dist");
