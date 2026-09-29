export const SURFACES = {
	sidebar: { kind: "panel", dockedKey: "jean.sidebarDocked", docked: true },
	queue: { kind: "panel", dockedKey: "jean.queueDocked", docked: false },
	search: { kind: "bar" },
	palette: { kind: "modal" },
	shortcuts: { kind: "modal" },
	settings: { kind: "modal" },
	nowPlaying: { kind: "route" },
} as const;

type Surfaces = typeof SURFACES;

export type Panel = {
	[Name in keyof Surfaces]: Surfaces[Name] extends { kind: "panel" }
		? Name
		: never;
}[keyof Surfaces];

export type Modal = {
	[Name in keyof Surfaces]: Surfaces[Name] extends { kind: "modal" }
		? Name
		: never;
}[keyof Surfaces];
