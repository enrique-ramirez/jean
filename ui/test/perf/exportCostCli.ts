import { measureExport } from "./exportCost.ts";

const [origin, repeats] = process.argv.slice(2);
process.stdout.write(
	JSON.stringify(await measureExport(origin, Number(repeats))),
);
