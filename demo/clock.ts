import type { createState } from "../test/fake-api/state.ts";

type FakeState = ReturnType<typeof createState>;

// **The one thing the demo adds to the player rather than borrows from it.**
//
// The fake never ticks, deliberately: beefweb pushes on change and never on a
// timer, so a suite that depended on the fake advancing would be testing
// behaviour the real player does not have. Position advances in the app's own
// interpolation instead. That is right for the specs and wrong for a demo,
// where a track that never ends means a visitor sees the same row for as long
// as they stay.
//
// So this is a clock, and it lives here rather than in `fake-api/` for the same
// reason the tests do not want one. It wraps the state instead of changing it:
// nothing under `test/fake-api/` learns that a demo exists.
//
// It fires only at the end of a track, which is what a real player does. It
// does not push a position every second -- the app interpolates that, and a
// stream that argued with the interpolation would look like a stutter.
export function withClock(state: FakeState): FakeState {
	// When the position the player is reporting was last true, in wall-clock ms.
	let anchored = Date.now();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const item = () => state.player.activeItem;

	const elapsed = () =>
		state.player.playbackState === "playing"
			? item().position + (Date.now() - anchored) / 1000
			: item().position;

	// Writes the true position back before anything reads it. The fake holds the
	// position it was last told about, which is 0 for a track that has been
	// playing three minutes -- so a pause that did not do this would report the
	// track back at its start, and the app, which believes the player, would
	// draw it there.
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
			// `next` at the end of a playlist does nothing at all, the way stepping
			// past the last row does. A player stops there rather than sitting on a
			// finished track forever.
			if (
				item().index === before.index &&
				item().playlistId === before.playlistId
			)
				state.stop();
		}, remaining * 1000);
	};

	// Every entry point that can change what is playing or where it is. Wrapped
	// rather than subscribed to, because the position has to be true *before*
	// the state notifies -- a listener runs after the snapshot the app receives
	// has already been built.
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
	// the active item without going through the calls above still has to re-arm.
	state.subscribe((changed) => {
		if (changed.player) return;
		rearm();
	});

	return state;
}
