import type { createState } from "../test/fake-api/state.ts";

type FakeState = ReturnType<typeof createState>;

// Pushing a position every second, the way a real player's state would, would argue with the
// app's own interpolation and look like a stutter -- so this fires only at the end of a track.
export function withClock(state: FakeState): FakeState {
	let positionTrueAt = Date.now();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const item = () => state.player.activeItem;

	const elapsed = () =>
		state.player.playbackState === "playing"
			? item().position + (Date.now() - positionTrueAt) / 1000
			: item().position;

	// The fake holds the position it was last told about, which is 0 for a track
	// that has been playing three minutes. Without this a pause would report the
	// track back at its start.
	const settle = () => {
		if (item().index >= 0)
			item().position = Math.min(elapsed(), item().duration);
	};

	const rearm = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		positionTrueAt = Date.now();

		const { duration, index } = item();
		if (state.player.playbackState !== "playing" || index < 0 || duration <= 0)
			return;

		const remaining = Math.max(0, duration - item().position);
		timer = setTimeout(() => {
			const before = { ...item() };
			state.next();
			// `next` at the end of a playlist does nothing at all, so detect that and
			// stop rather than sit on a finished track.
			if (
				item().index === before.index &&
				item().playlistId === before.playlistId
			)
				state.stop();
		}, remaining * 1000);
	};

	const driven = [
		"playItem",
		"playPause",
		"next",
		"previous",
		"stop",
		"patchPlayer",
	] as const;

	for (const name of driven) {
		const original = state[name] as (...args: unknown[]) => unknown;
		Object.defineProperty(state, name, {
			configurable: true,
			value: (...args: unknown[]) => {
				settle();
				const result = original.apply(state, args);
				rearm();
				return result;
			},
		});
	}

	state.subscribe((changed) => {
		if (changed.player) return;
		rearm();
	});

	return state;
}
