// A cell that had not finished in its bound. The run records it and goes on, since a page that
// never answers would otherwise hold the whole report back.
export class Over extends Error {
	bound: number;

	constructor(bound: number, reason: string) {
		super(reason);
		this.bound = bound;
	}
}

const never = Symbol("not finished");

// Resolves with `work`'s outcome, or rejects with `Over` once `bound` milliseconds pass. The work
// is left to run on: the context it drives is closed afterwards, which rejects whatever it awaits.
export async function within<T>(
	bound: number,
	reason: () => Promise<string>,
	work: () => Promise<T>,
): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const running = work();
	running.catch(() => undefined);
	const outcome = await Promise.race([
		running,
		new Promise<typeof never>((resolve) => {
			timer = setTimeout(() => resolve(never), bound);
		}),
	]).finally(() => clearTimeout(timer));
	if (outcome === never)
		throw new Over(
			bound,
			`not finished in ${bound / 1000} s; ${await reason()}`,
		);
	return outcome;
}

// Settles with `fallback` if `work` has not answered in `bound` milliseconds or throws.
export async function orElse<T>(
	bound: number,
	fallback: T,
	work: () => Promise<T>,
): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const answer = await Promise.race([
		work().catch(() => fallback),
		new Promise<T>((resolve) => {
			timer = setTimeout(() => resolve(fallback), bound);
		}),
	]);
	clearTimeout(timer);
	return answer;
}
