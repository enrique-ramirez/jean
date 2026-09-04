const SIZE = 32;

const FRAMES = 12;
const FRAME_MS = 150;

// The label is the one part a state repaints, so its geometry is the one thing duplicated from favicon.svg.
const LABEL_R = 5;
const HOLE_R = 1;
const HOLE_FILL = "#0e1013";

const LABEL_FILL = {
	playing: null,
	paused: "#bdc5cf",
	idle: "#bdc5cf",
	offline: "#ef675e",
} as const;

export type PlaybackBadge = keyof typeof LABEL_FILL;

const cache = new Map<string, string>();

let icon: HTMLLinkElement | null = null;
let canvas: CanvasRenderingContext2D | null = null;
let source: HTMLImageElement | null = null;
let pending: Promise<HTMLImageElement> | null = null;
let timer: number | undefined;
let badge: PlaybackBadge = "idle";

let angle = 0;

const sourceUrl = () => new URL("favicon.svg", document.baseURI).href;

function apply(href: string, type: string) {
	icon ??= document.querySelector("link[rel='icon']") as HTMLLinkElement;
	icon.type = type;
	icon.href = href;
}

function context() {
	if (!canvas) {
		const element = document.createElement("canvas");
		element.width = SIZE;
		element.height = SIZE;
		canvas = element.getContext("2d");
	}
	return canvas as CanvasRenderingContext2D;
}

function dot(ctx: CanvasRenderingContext2D, radius: number, fill: string) {
	ctx.beginPath();
	ctx.arc(SIZE / 2, SIZE / 2, radius, 0, 2 * Math.PI);
	ctx.fillStyle = fill;
	ctx.fill();
}

function disc(state: PlaybackBadge, turn: number) {
	const key = `${state}:${turn}`;
	const hit = cache.get(key);
	if (hit) return hit;

	const ctx = context();
	const centre = SIZE / 2;
	ctx.clearRect(0, 0, SIZE, SIZE);
	ctx.save();
	ctx.translate(centre, centre);
	ctx.rotate((turn / FRAMES) * 2 * Math.PI);
	ctx.drawImage(source as HTMLImageElement, -centre, -centre, SIZE, SIZE);
	ctx.restore();

	const fill = LABEL_FILL[state];
	if (fill) {
		dot(ctx, LABEL_R, fill);
		dot(ctx, HOLE_R, HOLE_FILL);
	}

	const url = ctx.canvas.toDataURL("image/png");
	cache.set(key, url);
	return url;
}

function load() {
	pending ??= new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = reject;
		image.src = sourceUrl();
	});
	return pending;
}

function halt() {
	clearInterval(timer);
	timer = undefined;
}

function paint(image: HTMLImageElement) {
	source = image;
	halt();
	apply(disc(badge, angle), "image/png");
	if (badge !== "playing") return;
	timer = window.setInterval(() => {
		angle = (angle + 1) % FRAMES;
		apply(disc("playing", angle), "image/png");
	}, FRAME_MS);
}

export function setFavicon(next: PlaybackBadge) {
	badge = next;
	halt();
	load().then(paint, () => {});
}
