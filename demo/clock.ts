import type { createState } from "../test/fake-api/state.ts";

type FakeState = ReturnType<typeof createState>;

// The one thing the demo adds to the fake player rather than borrows from it.
//
// beefweb pushes on change and never on a timer, so the fake never ticks and the
// app interpolates position itself. A demo still needs tracks to end, so this
// wraps the state -- nothing under `test/fake-api/` learns that a demo exists --
// and fires only at the end of a track. Pushing a position every second would
// argue with the interpolation and look like a stutter.
export function withClock(state: FakeState): FakeState {
	// When the position the player is reporting was last true, in wall-clock ms.
	let anchored = Date.now();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const item = () => state.player.activeItem;

	const elapsed = () =>
		state.player.playbackState === "playing"
			? item().position + (Date.now() - anchored) / 1000
			: item().position;

	// The fake holds the position it was last told about, which is 0 for a track
	// that has been playing three minutes. Without this a pause would report the
	// track back at its start, and the app believes the player.
	const settle = () => {
		if (item().index >= 0)
			item().position = Math.min(elapsed(), item().duration);
	};

	const rearm = () => {
		if (timer) clearTimeout(timer);
		timer = null;
		anchored = Date.now();

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

	// Wrapped rather than subscribed to: the position has to be true before the
	// state notifies, and a listener runs after the snapshot the app receives has
	// been built.
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

	// A track removed under the cursor, a playlist emptied: anything that changes
	// the active item without going through the calls above still re-arms.
	state.subscribe((changed) => {
		if (changed.player) return;
		rearm();
	});

	return state;
}
