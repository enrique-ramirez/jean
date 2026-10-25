export const PROJECT_NAMES = [
	"desktop",
	"mobile",
	"edge",
	"iphone",
	"firefox",
] as const;
export type ProjectName = (typeof PROJECT_NAMES)[number];

export interface Args {
	tracks: number[];
	url: string | null;
	runs: number;
	projects: ProjectName[];
	port: number | null;
	dist: string | null;
	trace: boolean;
}

const FORBIDDEN_PORTS = new Set([8123, 8881]);

export function parseArgs(argv: string[]): Args {
	const values = new Map<string, string[]>();
	const switches = new Set<string>();
	for (let at = 0; at < argv.length; at += 1) {
		const name = argv[at];
		if (!name.startsWith("--")) throw new Error(`unexpected argument ${name}`);
		if (name === "--trace") {
			switches.add(name);
			continue;
		}
		const value = argv[at + 1];
		if (value === undefined || value.startsWith("--"))
			throw new Error(`${name} needs a value`);
		values.set(name, [...(values.get(name) ?? []), value]);
		at += 1;
	}

	const known = new Set([
		"--tracks",
		"--url",
		"--runs",
		"--projects",
		"--port",
		"--dist",
	]);
	for (const name of values.keys())
		if (!known.has(name)) throw new Error(`unknown option ${name}`);

	const list = (name: string) =>
		(values.get(name) ?? []).flatMap((entry) => entry.split(","));

	const tracks = list("--tracks").map(Number);
	const url = values.get("--url")?.[0] ?? null;
	if (url === null && tracks.length === 0)
		throw new Error(
			"give --tracks <n>[,<n>...] for the fake or --url <origin> for a player",
		);
	if (url !== null && tracks.length > 0)
		throw new Error("--tracks and --url are two different targets");
	if (tracks.some((count) => !Number.isInteger(count) || count < 1))
		throw new Error("--tracks takes positive whole numbers");

	const projects = list("--projects");
	for (const name of projects)
		if (!PROJECT_NAMES.some((known) => known === name))
			throw new Error(
				`no project ${name}; the projects are ${PROJECT_NAMES.join(", ")}`,
			);

	const runs = Number(values.get("--runs")?.[0] ?? 3);
	if (!Number.isInteger(runs) || runs < 1)
		throw new Error("--runs takes a positive whole number");

	const port = values.has("--port") ? Number(values.get("--port")?.[0]) : null;
	if (port !== null && (!Number.isInteger(port) || FORBIDDEN_PORTS.has(port)))
		throw new Error(
			`--port takes a whole number other than ${[...FORBIDDEN_PORTS].join(" or ")}`,
		);

	const dist = values.get("--dist")?.[0] ?? null;
	if (dist !== null && url !== null)
		throw new Error(
			"--dist is a page for the fake to serve; --url has its own",
		);

	return {
		tracks,
		url,
		dist,
		runs,
		projects:
			projects.length > 0 ? (projects as ProjectName[]) : [...PROJECT_NAMES],
		port,
		trace: switches.has("--trace"),
	};
}
