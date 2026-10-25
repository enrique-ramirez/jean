import { readPages } from "./pages.ts";

const [origin] = process.argv.slice(2);
process.stdout.write(JSON.stringify(await readPages(origin)));
