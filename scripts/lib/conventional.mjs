// The one statement of what a commit subject here is: `type(scope)!: description`, Conventional
// Commits with the types and scopes below. scripts/commit-message.mjs enforces it, in the
// commit-msg hook and in CI; scripts/release-notes.mjs groups a release's commits by it; and
// plugins/fb2k/scripts/release.sh takes the release commit's subject from it. CONTRIBUTING.md,
// _Commits_, is the same rules for a person.

// In the order the release notes list them.
export const types = {
	feat: "Features",
	fix: "Fixes",
	perf: "Performance",
	refactor: "Refactoring",
	docs: "Documentation",
	test: "Tests",
	build: "Build",
	ci: "CI",
	style: "Style",
	chore: "Chores",
	revert: "Reverts",
};

// `release` is the scope of the commit plugins/fb2k/scripts/release.sh makes.
export const scopes = {
	foo_jean: ["plugins/fb2k/"],
	ui: ["ui/"],
	contract: ["contract/"],
	site: ["site/"],
	kit: [".claude/"],
	release: [],
};

const releasePrefix = "chore(release): v";

export const releaseSubject = (version) => `${releasePrefix}${version}`;

export const isReleaseSubject = (subject) => subject.startsWith(releasePrefix);

const grammar =
	/^(?<type>[a-z]+)(?:\((?<scope>[a-z_]+)\))?(?<bang>!)?: (?<description>\S.*)$/;

export function parse(message) {
	const [subject, ...rest] = message.split("\n");
	const match = grammar.exec(subject);
	if (!match) return null;
	const { type, scope, bang, description } = match.groups;
	const breaking =
		bang === "!" || rest.some((line) => line.startsWith("BREAKING CHANGE:"));
	return { type, scope, breaking, description };
}

const segments = (path) => path.split("/");
const isTest = (path) =>
	segments(path)
		.slice(0, -1)
		.some((segment) => segment === "test" || segment === "tests") ||
	/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
	/_test\.(cpp|h|mm)$/.test(path);
const isDocs = (path) => path.endsWith(".md");
const isCi = (path) => path.startsWith(".github/");
const isSource = (path) => !isTest(path) && !isDocs(path) && !isCi(path);

const only = (files, keep, what) =>
	files
		.filter((file) => !keep(file))
		.map((file) => `a ${what} commit touches ${file}`);

// A merge's or a revert's subject is git's own, and is not held to the grammar. With no `files`
// known, as when only the message of a commit is amended, the path rules are not applied.
export function problems(message, files = []) {
	const subject = message.split("\n")[0];
	if (subject.startsWith("Merge ") || subject.startsWith('Revert "')) return [];

	const parsed = parse(message);
	if (!parsed) return [`'${subject}' is not \`type(scope)!: description\``];

	const found = [];
	const { type, scope, description } = parsed;
	if (!Object.hasOwn(types, type))
		found.push(`type '${type}' is not one of ${Object.keys(types).join(", ")}`);
	if (scope !== undefined && !Object.hasOwn(scopes, scope))
		found.push(
			`scope '${scope}' is not one of ${Object.keys(scopes).join(", ")}`,
		);
	if (description.endsWith("."))
		found.push("the description ends with a period");
	if (files.length === 0) return found;

	if (type === "test") found.push(...only(files, isTest, "test"));
	if (type === "ci") found.push(...only(files, isCi, "ci"));
	if (type === "docs") found.push(...only(files, isDocs, "docs"));
	if (
		["feat", "fix", "perf", "refactor"].includes(type) &&
		!files.some(isSource)
	)
		found.push(`a ${type} commit touches only tests, documentation or CI`);

	const roots =
		scope !== undefined && Object.hasOwn(scopes, scope) ? scopes[scope] : [];
	if (roots.length > 0)
		found.push(
			...files
				.filter((file) => !roots.some((root) => file.startsWith(root)))
				.map(
					(file) =>
						`scope '${scope}' but ${file} is outside ${roots.join(", ")}`,
				),
		);
	return found;
}
