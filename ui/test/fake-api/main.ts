import { createServer } from "./server.ts";
import { createState } from "./state.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string | null) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : fallback;
};

const port = Number(flag("--port", "8881"));
const serveDir = flag("--serve", null);

// `createState()`'s own default holds no component, since that is what the suite's worker
// fixture resets away before any spec sees it. Standalone, nothing resets it, so this is the
// one caller that has to ask for a component that is there.
const server = createServer({ serveDir, state: createState({ fooJean: {} }) });

server.listen(port, () => {
	console.log(
		`fake foo_jean on http://localhost:${port}${serveDir ? ` (serving ${serveDir})` : ""}`,
	);
});
