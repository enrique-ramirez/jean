import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { takeSkipAsked } from "@/shared/api/beefweb";
import { Artwork } from "@/shared/ui/Artwork";
import styles from "./CoverWheel.module.css";

// Degrees between one sleeve and the next on the rim. The radius that goes with it is in the stylesheet, because it is
// spatial; the two are a pair and neither can be changed alone. See `src/features/now-playing/CLAUDE.md`.
const STEP = 22;

// How far across the stage a drag travels to bring the next sleeve to the middle, as a fraction of the stage's width.
const REACH = 0.45;

// How much of a drag past that still moves the wheel. Elastic rather than jammed, and it names the end of the travel.
const GIVE = 0.15;

// A short drag is still an instruction if it was quick.
const FLICK_PX = 50;

// How long a turn waits for the track it asked for. A skip at the end of a playlist plays nothing and reports nothing,
// so an unanswered turn is put back rather than left sitting on a sleeve that will never resolve.
const UNANSWERED_MS = 4000;

interface Sleeve {
	src: string;
	alt: string;
}

// Three nodes serve every position on the rim: consecutive integers never collide mod 3, and a node changing which
// position it holds is off screen when it does. So the sleeves are recycled rather than mounted, which is what keeps
// one from leaving the document under a finger -- the trap in `shared/ui/CLAUDE.md`.
const nodeOf = (at: number) => ((at % 3) + 3) % 3;

/**
 * The sleeves as a wheel: the playing one at the top of a rim whose centre is far below the screen, its neighbours
 * turned out of sight either side. A skip turns the rim rather than replacing the picture.
 *
 * The turn is written straight to the element rather than held in state. `useDragFraction` re-renders per move and is
 * right to -- it drives a 26px column -- but this surface is the whole player, and re-rendering it sixty times a second
 * would repaint the transport, the seek bar and the identity to move one transform.
 */
export function useCoverWheel({
	audibleTrackKey,
	playerTrackKey,
	artwork,
	alt,
	nextArtwork,
	previousArtwork,
	onSkip,
}: {
	/** What identifies the audible track, so a real change can be told from a re-render. The wheel follows the ear rather than the player: while a stream is attached those are a lag apart, and the sleeve on screen belongs to the sound coming out of it. */
	audibleTrackKey: string | null;
	/** The same for the player itself, which is never delayed. Only the undo reads it -- see below. */
	playerTrackKey: string | null;
	artwork: string | null;
	alt: string;
	/** The sleeves either side, where the player's order makes them knowable. Absent slots draw as loading. */
	nextArtwork: string | null;
	previousArtwork: string | null;
	onSkip: (by: number) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState(0);
	const [sleeves, setSleeves] = useState<Record<number, Sleeve>>({});
	// A turn is on screen before the player has answered it, so the identity has to say it is loading rather than draw
	// the track that is leaving.
	const [isAwaiting, setIsAwaiting] = useState(false);

	// Degrees the wheel is settled at, and degrees the finger is adding. Kept apart so a release animates from wherever
	// the drag left it to wherever the commit landed, rather than from one composite number to another.
	const settled = useRef(0);
	const dragging = useRef(0);
	// The stage's width at the moment a gesture began, so the mapping is measured once rather than per move.
	const reach = useRef(0);
	const unanswered = useRef<{ to: number; from: number } | null>(null);
	const undo = useRef<ReturnType<typeof setTimeout> | null>(null);

	const paint = useCallback((isFree: boolean) => {
		const wheel = ref.current;
		if (!wheel) return;
		// Free of the transition while a finger is on it: the rim is under the thumb and must not lag it.
		wheel.toggleAttribute("data-free", isFree);
		wheel.style.setProperty(
			"--turn",
			`${settled.current + dragging.current}deg`,
		);
	}, []);

	// The screen is unmounted when it is dismissed, so the wheel comes back with no `--turn` on it while `settled` still
	// remembers a rim that has been turned a dozen times. Unpainted, every slot sits off screen and there is no cover at
	// all until something turns it again.
	const attach = useCallback(
		(node: HTMLDivElement | null) => {
			ref.current = node;
			if (node) paint(false);
		},
		[paint],
	);

	const turnTo = useCallback(
		(at: number) => {
			settled.current = -at * STEP;
			setPosition(at);
			paint(false);
		},
		[paint],
	);

	// The player has named a track. Either it is the answer to a turn already on screen, or nothing here asked for it
	// and the set has moved on by itself -- which goes forward, the way it plays.
	const seen = useRef<string | null>(null);
	useEffect(() => {
		if (!audibleTrackKey || audibleTrackKey === seen.current) return;
		const isFirst = seen.current === null;
		seen.current = audibleTrackKey;

		const sleeve = artwork ? { src: artwork, alt } : null;
		const asked = unanswered.current;
		// Taken whichever branch runs. A turn this screen made itself already knows its direction and does not need the
		// record -- but leaving it unspent lets it steer the next track that ends of its own accord.
		const outside = takeSkipAsked();

		if (asked) {
			unanswered.current = null;
			setIsAwaiting(false);
			if (undo.current) clearTimeout(undo.current);
			if (sleeve) setSleeves((held) => ({ ...held, [asked.to]: sleeve }));
			return;
		}

		// Nothing here turned the wheel, so either something outside the screen asked for this -- the status bar, a key,
		// the media session -- or the set moved on by itself, which goes forward, the way it plays.
		const at = isFirst ? position : position + (outside ?? 1);
		if (!isFirst) turnTo(at);
		if (sleeve) setSleeves((held) => ({ ...held, [at]: sleeve }));
	}, [audibleTrackKey, artwork, alt, position, turnTo]);

	// Whether a turn was refused is a question about the player and never about the ear. The player answers a skip at
	// once; the sound arrives a lag later, and on the plain stream path that is seconds. Waiting for the ear here would
	// rewind a skip that had already landed.
	const confirmed = useRef<string | null>(null);
	useEffect(() => {
		if (!playerTrackKey || playerTrackKey === confirmed.current) return;
		confirmed.current = playerTrackKey;
		if (undo.current) clearTimeout(undo.current);
	}, [playerTrackKey]);

	// Prefill, and the reason it needs no branch anywhere else: a slot with a sleeve draws it and a slot without one
	// draws as loading, so an order that makes the neighbours knowable is an optimisation rather than a second path.
	// Never overwrites -- what a slot already holds is a track that really played, which beats a guess at one.
	useEffect(() => {
		setSleeves((held) => {
			const filled = { ...held };
			let added = false;
			for (const [at, src] of [
				[position + 1, nextArtwork],
				[position - 1, previousArtwork],
			] as const) {
				if (!src || filled[at]) continue;
				filled[at] = { src, alt: "" };
				added = true;
			}
			return added ? filled : held;
		});
	}, [nextArtwork, previousArtwork, position]);

	useEffect(
		() => () => {
			if (undo.current) clearTimeout(undo.current);
		},
		[],
	);

	const onDrag = useCallback(
		(dx: number) => {
			const wheel = ref.current;
			if (!wheel) return;
			if (!reach.current)
				reach.current = (wheel.clientWidth || window.innerWidth) * REACH;

			// Leftwards brings the next sleeve in, and the next sleeve sits further round, so leftwards turns the rim back.
			const of = dx / reach.current;
			const past = Math.max(0, Math.abs(of) - 1);
			dragging.current =
				Math.sign(of) * (Math.min(Math.abs(of), 1) + past * GIVE) * STEP;
			paint(true);
		},
		[paint],
	);

	// Turn now and ask afterwards. Every way of skipping from this screen goes through here, so a press of Previous
	// moves exactly as a swipe to the right does rather than waiting out a round trip and then guessing a direction.
	const skip = useCallback(
		(by: number) => {
			const to = position + by;
			turnTo(to);

			// Held whether or not the sleeve is already known. The rim is allowed to run ahead -- that is what makes a flick
			// feel immediate -- but the identity beside it must not go on naming the track that is leaving, which while a
			// stream is attached is a second or more of a sleeve and a title belonging to two different songs.
			unanswered.current = { to, from: position };
			setIsAwaiting(true);
			if (undo.current) clearTimeout(undo.current);
			undo.current = setTimeout(() => {
				const pending = unanswered.current;
				if (!pending) return;
				unanswered.current = null;
				setIsAwaiting(false);
				turnTo(pending.from);
			}, UNANSWERED_MS);

			onSkip(by);
		},
		[position, onSkip, turnTo],
	);

	const onDragEnd = useCallback(
		(dx: number, wasFlick: boolean) => {
			const across = reach.current;
			reach.current = 0;
			dragging.current = 0;

			const far = across > 0 && Math.abs(dx / across) >= 0.5;
			const flicked = wasFlick && Math.abs(dx) >= FLICK_PX;
			if (!far && !flicked) {
				paint(false);
				return;
			}

			skip(dx < 0 ? 1 : -1);
		},
		[skip, paint],
	);

	return {
		ref: attach,
		isAwaiting,
		skip,
		onDrag,
		onDragEnd,
		slots: [position - 1, position, position + 1].map((at) => ({
			at,
			node: nodeOf(at),
			sleeve: sleeves[at] ?? null,
			isCurrent: at === position,
		})),
	};
}

export function CoverWheel({
	ref,
	slots,
}: Pick<ReturnType<typeof useCoverWheel>, "ref" | "slots">) {
	return (
		<div className={styles.wheel} ref={ref} data-cover-wheel="">
			{slots.map(({ at, node, sleeve, isCurrent }) => (
				<div
					key={node}
					className={styles.slot}
					style={{ "--at": at } as CSSProperties}
					data-current={isCurrent || undefined}
				>
					{/* An absent slot is a track the player has not named yet, which is `undefined` rather than `null`: the same component holds it, shimmering, on the same shape it will draw the sleeve on. Two placeholders here was the wheel changing its mind about what a missing cover looks like halfway through a turn. */}
					<Artwork
						src={sleeve?.src}
						alt={sleeve?.alt ?? ""}
						className={styles.cover}
					/>
				</div>
			))}
		</div>
	);
}
