import { cp, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemo } from "@jean/ui/demo/build.ts";
import { build, type Plugin } from "vite";

import {
	type Embed,
	frameSrc,
	HERO,
	SECTIONS,
	type Section,
} from "./embeds.ts";
import { TAKE, WIDE } from "./labels.ts";
import { inline, part, section } from "./readme.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(HERE, "dist-site");

const attr = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const scrollTables = (markup: string) =>
	markup
		.replace(/<table>/g, '<div class="scroller"><table>')
		.replace(/<\/table>/g, "</table></div>");

const frame = (
	embed: Embed,
	shape: string,
	eager = false,
	catchable = false,
) => `
			<div
				class="frame frame--${shape}"
				data-src="${attr(frameSrc(embed))}"
				data-frame-title="${attr(embed.title)}"${eager ? "\n\t\t\t\tdata-eager" : ""}
			>
				<div class="frame-hold">Starting the player</div>${catchable ? '\n\t\t\t\t<div class="frame-catch"></div>' : ""}
			</div>`;

const takeable = (embed: Embed, shape: string, eager = false) => `
			<div class="frame-bar">
				<span class="frame-screen">${attr(embed.screen)}</span>
				<button type="button" class="frame-pill" aria-pressed="false">${TAKE}</button>
			</div>${frame(embed, shape, eager, true)}`;

const compare = (frames: Embed[]) => {
	const [under, over] = frames;
	if (!under || !over) throw new Error("a comparison takes two frames");
	return `
			<div class="frame-bar">
				<span class="frame-screen">Now playing</span>
				<button type="button" class="frame-narrow" aria-pressed="false">${WIDE}</button>
			</div>
			<div class="compare">
				${frame(under, "compare").trim()}
				<div class="compare-over">${frame(over, "compare").trim()}</div>
				<div class="compare-line" aria-hidden="true"></div>
				<input
					type="range"
					class="compare-range"
					min="0"
					max="100"
					step="1"
					value="50"
					aria-label="How much of the dark theme to show"
				/>
			</div>`;
};

const embedded = (entry: Section) => {
	const first = entry.frames[0];
	if (!first) throw new Error(`site:${entry.region} has no frame`);
	const inside =
		entry.shape === "compare"
			? compare(entry.frames)
			: takeable(first, entry.shape);
	return `
		<figure class="embed">${inside}
			<figcaption class="frame-note">${inline(entry.caption ?? "")}</figcaption>
		</figure>`;
};

function page(markdown: string) {
	const sections = SECTIONS.map((entry) => {
		const words = part(markdown, entry.region);
		return `
		<article class="feature feature--${entry.shape}">
			<div class="feature-copy">
				<h2>${words.heading}</h2>
				${words.body}
			</div>${embedded(entry)}
		</article>`;
	}).join("\n");

	return {
		tagline: inline(
			section(markdown, "tagline").replace(/^<p>|<\/p>\n?$/g, ""),
		),
		hero: `<figure class="embed">${takeable(HERO, "wide", true)}</figure>`,
		sections,
		more: section(markdown, "more"),
		closing: section(markdown, "closing"),
		extra: section(markdown, "extra"),
		requirements: scrollTables(section(markdown, "requirements")),
		install: section(markdown, "install"),
		profiles: scrollTables(section(markdown, "profiles")),
	};
}

const slots = (filled: Record<string, string>): Plugin => ({
	name: "jean-site-slots",
	transformIndexHtml(markup) {
		return markup.replace(/<!--slot:([a-z]+)-->/g, (_, name: string) => {
			if (!(name in filled))
				throw new Error(`the page asks for a slot called ${name}`);
			return filled[name];
		});
	},
});

const markdown = await readFile(resolve(ROOT, "README.md"), "utf8");

await build({
	configFile: false,
	root: HERE,
	base: "./",
	publicDir: false,
	plugins: [slots(page(markdown))],
	build: { outDir: OUT, emptyOutDir: true },
});

await cp(
	fileURLToPath(import.meta.resolve("@jean/ui/public/favicon.svg")),
	resolve(OUT, "favicon.svg"),
);

await buildDemo(resolve(OUT, "demo"));

console.log(`site built into ${OUT}`);
