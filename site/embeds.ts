export type Shape = "wide" | "column" | "compare";

export interface Embed {
	route: string;
	settings?: Record<string, unknown>;
	focus?: "search";
	title: string;
	screen: string;
}

export interface Section {
	region: string;
	shape: Shape;
	frames: Embed[];
	caption?: string;
}

export const HERO: Embed = {
	route: "home",
	settings: { theme: "dark" },
	title: "Jean, open on the home screen",
	screen: "Home",
};

export const SECTIONS: Section[] = [
	{
		region: "rediscover",
		shape: "wide",
		frames: [
			{
				route: "all",
				settings: { theme: "dark", layout: "compact", heat: true },
				title: "Jean, the whole library with its play-count shading",
				screen: "All music",
			},
		],
		caption:
			"The warmer a row, the more you have played it, measured against the rest of this list.",
	},
	{
		region: "search",
		shape: "column",
		frames: [
			{
				route: "search/love",
				settings: { theme: "dark", layout: "compact" },
				focus: "search",
				title: "Jean, searching the library",
				screen: "Search",
			},
		],
		caption: "Take the window and type something else into the box.",
	},
	{
		region: "nowplaying",
		shape: "compare",
		frames: [
			{
				route: "playing/lyrics",
				settings: { theme: "dark" },
				title: "Jean playing a track, in the dark theme",
				screen: "Dark",
			},
			{
				route: "playing/lyrics",
				settings: { theme: "light" },
				title: "Jean playing the same track, in the light theme",
				screen: "Light",
			},
		],
		caption:
			"Dark on the left, light on the right, and both of them are running. Drag the divider.",
	},
];

export const frameSrc = (embed: Embed): string => {
	const params = new URLSearchParams({ embed: "" });
	for (const [key, value] of Object.entries(embed.settings ?? {}))
		params.set(`set.${key}`, JSON.stringify(value));
	if (embed.focus) params.set("focus", embed.focus);
	return `demo/?${params}#/${embed.route}`;
};
