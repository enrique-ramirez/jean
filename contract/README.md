# The contract

`openapi.yaml` is the HTTP contract between Jean and whatever writes tags, keeps autoplaylists and streams audio for it. `foo_jean` is the implementation that exists; nothing in the contract is about foobar2000, and nothing here assumes it.

This package is the two things that hang off that file: a conformance suite any implementation can be driven with, and the step that regenerates Jean's TypeScript client from it.

## What reads it

Five things, each of which spells the path out for itself, so a move breaks all five at once:

- `spec.ts`, which inlines every `$ref` and hands the operations to both suites.
- `pnpm types:api`, which regenerates `ui/src/shared/api/fooJeanSchema.d.ts`.
- `plugins/fb2k/tests/support/repository.cpp`, which `spec.cpp` asks for the repository root: it takes `__FILE__` and strips the literal suffix in `kSelf`.
- `plugins/fb2k/scripts/lib/version-header.sh` and `version-header.ps1`, which write `plugins/fb2k/src/core/version.h` from the `info` block before every build, so `title`, `version` and `x-api-version` are typed here and nowhere else. `release.sh`, `release-tag.sh` and `build-mac.sh` read `info.version` through the same library, for the release tag and the bundle's `Info.plist`.
- `plugins/fb2k/scripts/embed-ui.mjs`, which compiles it into the component beside `docs/`, so an install answers it at `GET /openapi.yaml` and renders it at `GET /docs`.

## The served copy

`docs/` is the page `GET /docs` answers: `index.html`, and `init.js`, which points Swagger UI at `GET /openapi.yaml` on the origin that served the page, so _Try it out_ reaches that install rather than the example host under `servers`. Swagger UI's own stylesheet and bundle come from the `swagger-ui-dist` package at build time, and `plugins/fb2k/scripts/embed-ui.mjs` compiles the four files into the component under `api/docs/`, beside the contract itself.

## Running the suite

```sh
CONTRACT_URL=http://<player-host>:8881/api pnpm test:contract
```

`CONTRACT_URL` is the base url the spec's `servers` block describes, including the `/api` prefix. It is not required: `test/conformance.test.ts` skips rather than fails without it, so a run with no player in reach costs nothing.

A run changes little on the player, and `probes.ts` says beside each probe why it is shaped to touch nothing. What it does change: it empties the play queue, since `DELETE /queue` carries no revision to refuse it against, so point `CONTRACT_URL` at an install whose queue is nobody's to lose. It toggles, resumes, pauses, skips and stops playback, and leaves the player stopped. It creates one autoplaylist, titled and keyed for the run, and deletes it again; a run that dies between the two leaves it behind, named so it is obvious what it was. It opens the stream and hangs up at once, so under `muteWhileStreaming` the player stays silent until the linger runs out. And it creates one private session, plays the library's first track in it with nobody listening, so nothing is decoded or heard, and leaves it. It declares a column set of its own through the rows route and reads no row; where the library is not built to that one column it rebuilds, so a client using the install declares its own again. It writes no tag: the address it sends names a track no library holds.

## What it checks

One request per operation the spec publishes, in an order that lets a playlist be created before it is repointed and deleted, and a ticket be minted before the stream it opens. `test/conformance.test.ts` is what each answer is held to, and `shape.ts` with `test/spec.test.ts` beside it is what checking a document against a schema means.

Two decisions behind those assertions are not readable from them.

A `503` is how an implementation says it cannot do a thing at all. The contract publishes that status for tag writing, for autoplaylists and for streaming. A host that cannot do one of them answers `503` in the published shape, passes, and is reported as declining it. Everything else fails: an unpublished status, a document with the wrong keys, an error string the contract does not publish, no answer. That is the whole difference between not implemented and implemented wrongly, in the contract's own vocabulary.

Request bodies come from the spec's own examples wherever it offers one. So the query an autoplaylist is created with is the player's language, not a dialect written into this suite: the contract says the player owns that language, and the suite takes it from there.

## Claiming conformance

An implementation conforms when this suite is green against it. Every operation under `paths:` is routed, and only the statuses that operation's `responses:` lists come back. Every document carries exactly the keys its schema declares, and a field the schema enumerates or fixes carries one of the values it publishes. An error string the contract does not publish fails on its own, with every key around it right. So does a refusal claiming the write it refused.

**Add an operation to the spec in the same change that implements it.** `test/spec.test.ts` fails when the spec publishes something the suite does not drive, so a new route has to be driven before it can be shipped.

## The generated client

`ui/src/shared/api/fooJeanSchema.d.ts` is `openapi-typescript` output from that spec:

```sh
pnpm types:api
```

Nothing in the ordinary build runs it, which is how it can go stale without anybody noticing, so `.github/workflows/contract.yml` runs it and fails when the result differs from what is committed. Regenerate in the same change as any spec edit.

The generator is fetched by `pnpm dlx` at the pinned version rather than installed. `openapi-typescript` builds its output through the compiler's node factory, and the native TypeScript 7 this repository runs does not expose `ts.factory` at all. An installed copy would drag a second TypeScript into the workspace to load against.
