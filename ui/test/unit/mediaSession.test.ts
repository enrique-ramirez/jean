import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import * as mediaSessionModule from "../../src/app/useMediaSession.ts";

// A browser exposes `navigator.mediaSession` only in a secure context, and Jean
// is a general-purpose UI that may be served over plain HTTP on a LAN. The e2e
// suite is served from localhost, which a browser counts as secure whatever the
// scheme, so an insecure page is a state no spec there can reach.
//
// The hook needs a render and there is no DOM under `node`, so what is exercised
// here is the accessor the effects in `useMediaSession.ts` reach the session
// through. The guard covers the whole file for exactly as long as that stays the
// module's one reader of `navigator.mediaSession`.

type Accessor = () => unknown;

const accessor = (mediaSessionModule as { mediaSession?: Accessor })
	.mediaSession;

const SECURE = true;
const INSECURE = false;

const define = (name: string, value: unknown) =>
	Object.defineProperty(globalThis, name, {
		value,
		configurable: true,
		writable: true,
	});

type Page = { reads: string[]; session: object };

const served = (t: TestContext, secure: boolean): Page => {
	const reads: string[] = [];
	const session = { metadata: null };

	const navigatorLike = new Proxy(
		{ mediaSession: session },
		{
			get(target, property, receiver) {
				if (property === "mediaSession") reads.push("read");
				return Reflect.get(target, property, receiver);
			},
			set(target, property, held, receiver) {
				if (property === "mediaSession") reads.push("written");
				return Reflect.set(target, property, held, receiver);
			},
		},
	);

	const was = ["navigator", "isSecureContext", "window", "self"].map(
		(name) =>
			[name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
	);

	define("navigator", navigatorLike);
	define("isSecureContext", secure);
	// `window` and `self` are the global object in a browser, so one value
	// answers all three spellings of the question.
	define("window", globalThis);
	define("self", globalThis);

	t.after(() => {
		for (const [name, descriptor] of was) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete (globalThis as Record<string, unknown>)[name];
		}
	});

	return { reads, session };
};

const held = (): unknown => {
	assert.ok(
		accessor,
		"`useMediaSession.ts` exports no `mediaSession` accessor to put the guard in",
	);
	return accessor();
};

test("touches no media session where the page is not a secure context", (t) => {
	const page = served(t, INSECURE);

	const session = held();

	assert.deepEqual(page.reads, []);
	assert.ok(!session, "an insecure page is handed no session at all");
});

// Without this one the guard passes on a module that answers nothing to
// everybody, breaking the media session in silence on a secure page too.
test("hands back the browser's media session where the page is secure", (t) => {
	const page = served(t, SECURE);

	assert.equal(held(), page.session);
});
