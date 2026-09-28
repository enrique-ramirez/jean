const SIZE = 32;

const FRAMES = 12;
const FRAME_MS = 150;

// The label is the one part a state repaints, so its geometry is duplicated from `favicon.svg`.
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
let drawing: CanvasRenderingContext2D | null = null;
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

function drawingContext() {
	if (!drawing) {
		const element = document.createElement("canvas");
		element.width = SIZE;
		element.height = SIZE;
		drawing = element.getContext("2d");
	}
	return drawing as CanvasRenderingContext2D;
}

function dot(context: CanvasRenderingContext2D, radius: number, fill: string) {
	context.beginPath();
	context.arc(SIZE / 2, SIZE / 2, radius, 0, 2 * Math.PI);
	context.fillStyle = fill;
	context.fill();
}

// Rasterised rather than animated in the SVG: a CSS-animated SVG favicon animates only in Firefox,
// and a media query inside an SVG loaded as an image resolves inconsistently.
function disc(state: PlaybackBadge, turn: number) {
	const key = `${state}:${turn}`;
	const hit = cache.get(key);
	if (hit) return hit;

	const context = drawingContext();
	const centre = SIZE / 2;
	context.clearRect(0, 0, SIZE, SIZE);
	context.save();
	context.translate(centre, centre);
	context.rotate((turn / FRAMES) * 2 * Math.PI);
	context.drawImage(source as HTMLImageElement, -centre, -centre, SIZE, SIZE);
	context.restore();

	const fill = LABEL_FILL[state];
	if (fill) {
		dot(context, LABEL_R, fill);
		dot(context, HOLE_R, HOLE_FILL);
	}

	const url = context.canvas.toDataURL("image/png");
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
	// A browser clamps a background tab's timers to about a second, which slows the spin there.
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
