import { createServer } from "./server.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string | null) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : fallback;
};

const port = Number(flag("--port", "8880"));
const serveDir = flag("--serve", null);

createServer({ serveDir }).listen(port, () => {
	console.log(
		`fake player API on http://localhost:${port}${serveDir ? ` (serving ${serveDir})` : ""}`,
	);
});
