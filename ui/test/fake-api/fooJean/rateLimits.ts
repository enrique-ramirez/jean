import { json, type Responder } from "../http.ts";

export type Bucket =
	| "playlistChanges"
	| "libraryRebuilds"
	| "artwork"
	| "tagWrites"
	| "previews"
	| "statePolls";

export interface BucketSize {
	burst: number;
	refillMs: number;
}

export type RateLimits = Partial<Record<Bucket, BucketSize>>;

// `kPlaylistBurst` and its siblings in `plugins/fb2k/src/core/http_server.cpp`.
export const COMPONENT_RATE_LIMITS: Record<Bucket, BucketSize> = {
	playlistChanges: { burst: 30, refillMs: 1000 },
	libraryRebuilds: { burst: 3, refillMs: 30_000 },
	artwork: { burst: 300, refillMs: 50 },
	tagWrites: { burst: 200, refillMs: 50 },
	previews: { burst: 30, refillMs: 200 },
	statePolls: { burst: 30, refillMs: 100 },
};

// `foo_jean` keeps one bucket per source address for state polls and one for the whole
// server for everything else.
const PER_CLIENT = new Set<Bucket>(["statePolls"]);

const PLAYLIST_CHANGES: [string, RegExp][] = [
	["POST", /^\/api\/playlists$/],
	["POST", /^\/api\/playlists\/[^/]+$/],
	["DELETE", /^\/api\/playlists\/[^/]+$/],
	["POST", /^\/api\/playlists\/[^/]+\/move$/],
	["POST", /^\/api\/playlists\/[^/]+\/items$/],
	["POST", /^\/api\/playlists\/own\/[^/]+\/items$/],
	["DELETE", /^\/api\/playlists\/own\/[^/]+\/items$/],
	["POST", /^\/api\/playlists\/[^/]+\/items\/(copy|remove|move|sort)$/],
	["POST", /^\/api\/autoplaylists$/],
	["POST", /^\/api\/autoplaylists\/[^/]+$/],
	["DELETE", /^\/api\/autoplaylists\/[^/]+$/],
	["POST", /^\/api\/queue(\/move)?$/],
	["DELETE", /^\/api\/queue(\/[^/]+)?$/],
];

// The export spends from `libraryRebuilds` only when it starts a build, which is
// `handleLibrary`'s to decide, so it is not named here.
export const bucketOf = (method: string, path: string): Bucket | null => {
	if (method === "GET" && path === "/api/state") return "statePolls";
	if (method === "GET" && path.startsWith("/api/artwork")) return "artwork";
	if (method === "POST" && path === "/api/tags") return "tagWrites";
	if (method === "POST" && path === "/api/autoplaylists/preview")
		return "previews";
	if (method === "POST" && path === "/api/library/refresh")
		return "libraryRebuilds";
	if (
		PLAYLIST_CHANGES.some(
			([verb, pattern]) => verb === method && pattern.test(path),
		)
	)
		return "playlistChanges";
	return null;
};

interface Tokens {
	tokens: number;
	at: number;
}

export type Limiter = Map<string, Tokens>;

// A bucket starts full and refills continuously, never past its burst.
export const spend = (
	limiter: Limiter,
	limits: RateLimits,
	bucket: Bucket,
	client: string,
	now = Date.now(),
): boolean => {
	const size = limits[bucket];
	if (!size) return true;

	const key = PER_CLIENT.has(bucket) ? `${bucket} ${client}` : bucket;
	const held = limiter.get(key) ?? { tokens: size.burst, at: now };
	const tokens = Math.min(
		size.burst,
		held.tokens + (now - held.at) / size.refillMs,
	);

	if (tokens < 1) {
		limiter.set(key, { tokens, at: now });
		return false;
	}

	limiter.set(key, { tokens: tokens - 1, at: now });
	return true;
};

// Word for word what the component answers from each bucket. The autoplaylist routes carry a
// `detail` the other playlist changes do not.
const REFUSALS: Record<Bucket, { retryAfter: string; body: unknown }> = {
	playlistChanges: {
		retryAfter: "1",
		body: { error: "too many requests", detail: "" },
	},
	libraryRebuilds: {
		retryAfter: "30",
		body: { error: "too many library refreshes" },
	},
	artwork: { retryAfter: "1", body: { error: "too many artwork requests" } },
	tagWrites: {
		retryAfter: "1",
		body: { written: false, error: "too many tag writes" },
	},
	previews: {
		retryAfter: "1",
		body: {
			error: "too many requests",
			detail: "query previews are arriving faster than they can be run",
		},
	},
	statePolls: { retryAfter: "1", body: { error: "too many state polls" } },
};

const AUTOPLAYLIST_CHANGES_REFUSED = {
	error: "too many requests",
	detail: "playlist changes are arriving faster than they can be made",
};

export const refuseTooFast = (
	response: Responder,
	bucket: Bucket,
	path = "",
) => {
	const refusal = REFUSALS[bucket];
	response.setHeader("Retry-After", refusal.retryAfter);
	return json(
		response,
		bucket === "playlistChanges" && path.startsWith("/api/autoplaylists")
			? AUTOPLAYLIST_CHANGES_REFUSED
			: refusal.body,
		429,
	);
};
