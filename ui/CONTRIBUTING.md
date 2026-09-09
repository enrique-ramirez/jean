# Contributing

How to write code in this repo. To *use* Jean, read the [README](../README.md).

Four other documents, and they do not overlap: [ARCHITECTURE.md](./ARCHITECTURE.md) is how the pieces fit and why the boundaries sit where they do; [src/shared/api/README.md](src/shared/api/README.md) is what beefweb and `foo_jean` return; [test/README.md](./test/README.md) is the suite and the fake player; [CLAUDE.md](../CLAUDE.md) is what a coding agent cannot infer from the code, with one beside each part of the app for what is local to it.

## 1. The development loop

You do not deploy to a player to develop. Jean is a static SPA that talks to beefweb over HTTP; it does not need to be served *by* beefweb. Vite proxies `/api` to a real player, so the app is same-origin, there is no CORS to configure, and nothing changes on the player side.

```sh
pnpm install
pnpm dev            # http://localhost:8123
```

Point it at a player with `BEEFWEB_URL`, in the environment or in `.env.local` (copy `.env.example`):

```sh
BEEFWEB_URL=http://<player-host>:8880 pnpm dev
```

The dev server binds on the LAN (`host: true`), so a phone can load it and hit the same proxy. The port is `strictPort`: `foo_jean` matches the dev origin against an exact allowlist, so sliding to the next free port would report the component unreachable with nothing on screen saying why.

No player in reach? `pnpm fake` serves the in-memory one on `:8880`, and `BEEFWEB_URL=http://localhost:8880 pnpm dev` points at it.

## 2. The commands

```sh
pnpm dev            # dev server, HMR, /api proxied
pnpm build          # typecheck, then bundle into dist/
pnpm preview        # serve that build
pnpm typecheck      # tsc across app, fake player and specs
pnpm lint           # biome check
pnpm lint:fix       # biome check --write
pnpm format         # biome format --write
pnpm test           # test:unit, then test:e2e
pnpm test:unit      # node --test over test/unit/
pnpm test:e2e       # playwright, desktop and mobile
pnpm test:ui        # pick and watch tests interactively
pnpm test:live      # the small suite against a real player. Needs LIVE
pnpm fake           # the fake player alone, on :8880
pnpm demo           # build the live demo into dist-demo/
pnpm demo:preview   # serve that
pnpm sync-kit       # refresh .claude/ from the ai-engineering kit
```

`pnpm lint` and `pnpm typecheck` MUST pass. Both are seconds; run them freely. `pnpm test:unit` is nearly as cheap.

**`pnpm test:e2e` is not.** A full Playwright run is desktop and mobile across the whole suite: it loads the machine and floods an agent's context. Run the specs that cover what you changed, such as `pnpm test:e2e test/e2e/queue.spec.ts`, `--grep "toast"` or `--project=desktop`, as often as you like. Keep the full run as a final verification, once, when the change is substantial enough that something outside the specs you already ran could plausibly have broken. Changes to documentation, comments or configuration need no run at all. See `test/README.md`.

## 3. `foo_jean` is the one thing the proxy does not cover

Every other request is a root-relative `/api` path the dev proxy forwards. The optional tag-writing and streaming component listens on a port of its own, so its address is a *host* and a port rather than a path, and on the dev server that host is your machine rather than the player's. `vite.config.ts` takes it from `BEEFWEB_URL` and injects it as `__PLAYER_HOST__`.

The request is then genuinely cross-origin in a way it never is in a build, and the component must be told to accept it. Add the dev server to `<profile>/foo_jean/config.json` and restart the player:

```jsonc
"allowedOrigins": ["http://localhost:8123"]
```

Add the LAN name too if you test on a phone against the dev server. None of this applies to a build, where beefweb serves Jean and the hosts match.

## 4. Where things live

```
src/
  shared/     knows nothing about Jean. api/ (beefweb client + wire types), ui/,
              lib/, hooks/, keyboard/, styles/
  domain/     what Jean is about, as data and behaviour with no route of its own
    track/    rows, refs, the source seam, the virtualised list machinery
    library/  the library as one array, its search, and what plays a set
    player/   player state, position interpolation, the volume curve, the listener
  features/   one folder per thing a user can do: home, search, genres, library,
              playlist, now-playing, queue, settings
  app/        the shell: App, Sidebar, CommandPalette, theme, hash routing
test/
  unit/       node --test, for logic with no user-visible surface of its own
  fake-api/   an in-memory foobar2000: portable route tables, plus the node
              sockets that serve them
  e2e/        the specs, in a real browser against that fake
  live/       a small suite against a player that is actually running
demo/         the live demo -- the same fake, in a service worker
```

1. **Imports run one way: `app → features → domain → shared`.** Biome's `noRestrictedImports` enforces it per tier, so a violation fails `pnpm lint`.
2. Within `domain` the slices form a DAG (`library → track → player`). Sideways is allowed; a cycle is not.
3. Import anything outside its own folder through the `@/` alias (`@/domain/track/fields`). Same-folder imports stay relative.
4. A file whose home is unclear is usually in the wrong tier. Shared infrastructure is not a feature; a domain concept is not one view of it.

[ARCHITECTURE.md](./ARCHITECTURE.md) is why those boundaries sit there, where state lives, and what the two optional-component seams are.

## 5. Design

The standard is one thing: control complexity so a person can read the result. Craftsmanship and simplicity agree on nearly all of what follows: names carry the meaning, a unit does one thing, duplication is a defect, clarity beats cleverness. Where they pull apart is how much structure is worth its cost, and that is settled below in favour of the simpler reading.

1. **Structure is never free, and must earn its place.** SOLID describes forces, not a checklist. An interface, a factory or a layer is justified by a second caller that exists, not by one that might. "Open for extension" is not a licence to design for a change nobody has asked for; the cheapest way to be open to a change is to be small enough to alter.
2. **Extract until the name stops paying.** Pull a block out when its name tells the reader more than the code did. Stop when following one idea means jumping between fragments that only make sense together. A shredded function is harder to read than the loop it replaced, and readability is the whole point.
3. **One reason to change.** A unit that both decides and acts has two. Keep the decision pure and testable, and put the mechanism where it belongs.
4. **Names are the primary documentation.** If a name needs a comment, the name is wrong. Reach for a better name before reaching for a sentence.
5. **The second copy is the bug.** Two statements of one fact drift, silently. Name it once and let both callers reach it.
6. **Do one thing well, and compose.** Prefer a small piece with a plain interface over a subsystem with options. Prefer passing a value in to reaching out for one. It is what makes a thing testable, and it is dependency inversion at the only scale that reliably pays.
7. **Be pragmatic before dogmatic.** No pattern is owed an appearance. If a rule here would make a file harder to read, the rule is wrong for that file; say so in the change rather than obeying it quietly.
8. **This app already has its one architectural boundary, and it is enough.** Imports run `app → features → domain → shared` and Biome fails the build on a violation, so the dependencies point inward without anyone policing it. Keep that direction exact; do not introduce a container, a service locator or a mediator to soften it.

## 6. Naming

1. **Never name a store, a parser or a helper after the component beside it.** A case-insensitive filesystem cannot tell `toasts.ts` from `Toasts.tsx`, so TypeScript resolves `'./Toasts'` to the wrong file silently. Hence `toastStore.ts`, `lyricsFormat.ts`, `volumeScale.ts`.
2. **Never name a declaration file after the module beside it.** `fooJean.d.ts` next to `fooJean.ts` is read as that file's own declarations. The generated component types are `fooJeanSchema.d.ts`.
3. Components are `PascalCase.tsx`, hooks are `useThing.ts`, everything else is `camelCase.ts`.
4. Stylesheets are `Component.module.css`, beside the component.

## 7. Styling

1. **CSS Modules, colocated with the component.** The only global stylesheets are `shared/styles/tokens.css` (the palette and scale, as custom properties) and `base.css`. Re-theming Jean SHOULD mean editing custom properties and nothing else.
2. **A rule in one module that overrides another's MUST outrank it on specificity, never merely follow it.** Module order in the bundle follows import order, and import sorting can flip two rules of equal specificity.
3. Anything spatial belongs to a media query, not to a JS breakpoint flag.
4. Animate compositor properties only: `transform`, `scale`, `rotate`, `opacity`.
5. **A new stacking layer goes in the table in `ARCHITECTURE.md` before it goes in a stylesheet.** The app-level scale is shared by everything, and picking a number without reading it is how a dialog ends up under a toolbar.

## 8. Comments

Write a comment when the code is correct **because of something outside this repository**, and name that thing: what beefweb, foobar2000, DeaDBeeF, `foo_jean`, a browser or a library actually does. Every other claim a reader can check by reading; that one they cannot.

Everything else that seems to want a sentence is a name you have not found yet, a function you have not extracted, or a fact that belongs in a document.

1. **Why a value was chosen is a named constant.** A duration, a threshold, a breakpoint, a `staleTime`. A name says it at every use rather than once above one of them.
2. **What the code does is the code.** If following it needs prose, the prose is a bug report against the structure. Fix the structure.
3. **How the parts fit is `ARCHITECTURE.md`; what the player answers is `src/shared/api/README.md`.** An external fact that bites in several files is written there once, and the files depending on it say nothing, or point there in a clause.
4. **Specs carry more.** A spec's name states the behaviour; a comment may state why the case exists at all and what breaks without it. That is documentation and it earns its place. Narrating the assertions is not.

**The test, before you write one.** Strip the comment and hand the code to somebody competent who has not seen it:

| they get it right | verdict |
|---|---|
| from the code | it was never needed |
| only because they happen to know beefweb, or how Safari handles it | the fact is real; it belongs in the docs |
| they cannot get it at all | write the comment |

`src/` should be near zero. An exception is allowed, and should be rare enough that meeting one is a surprise. `.claude/agents/comment-reaper.md` runs that test with an agent that has not seen the file.

**A lint suppression is code, not a comment, and carries its reason.** The `useExhaustiveDependencies` suppressions here are all one shape: a dependency that exists to *fire* an effect rather than to be read inside it. The rule cannot model that, so `lint:fix` would remove every one and break the feature silently. Read them before running it.

## 9. Documentation

Documentation states the current design and nothing else. No history: what something used to be, why it changed, or what was rejected belongs in git rather than in a file. The one exception is a trap a reader would actively revert into. Write that as an imperative rule, not as a story. No personal detail either: no names, machines, hostnames, addresses or real library paths, in prose, comments or test data. Use placeholders. Public repository URLs are fine.

**No measurements.** A measured number ties Jean to one library on one machine and then ships to everyone. Record the constraint a measurement established, such as "beefweb hangs up on a body over 1 MiB" or "there is no way to ask for a thumbnail", and never the measurement itself.

Never hard-wrap prose. One paragraph is one line, however long; editors wrap.

Each file has one job. `README.md` is what the project is and how to use it. `ui/CONTRIBUTING.md` is how to write its code. `ui/ARCHITECTURE.md` is how the parts fit. `ui/src/shared/api/README.md` is the player's surface. A `CLAUDE.md` is what an agent cannot read off the code, and stays short. Anything that is really a contribution rule belongs here and is linked from there, never copied.

`.claude/hooks/check-style.sh` fails an edit that reintroduces personal detail, history, hard-wrapped prose, a recorded measurement, an em dash, or one of the mechanical phrases in `.claude/voice/register.txt`. It fires on the edit tools and on a shell command that wrote a file, so a heredoc does not walk past it. It only catches what a grep can be certain of; the rest is your judgement.

Two reviewers cover that rest, over uncommitted changes and in this order: `style-reviewer` for design, structure, naming and duplication, then `comment-reaper` for comments and the prose of documentation. Run both before asking for a commit. Comment density is the rule that slips first, and it slips a little at a time.

`.claude/review-profile.md` is what tells both agents about this repository, and it carries a block per project: *Everywhere* applies to any diff, and `ui/` is the block that covers this directory. The agents, the hooks and the voice files come from the `ai-engineering` kit and are the same in every project; the profile is the only part that is Jean's.

`pnpm sync-kit` takes the kit's current version of those files. It reports anything under `.claude/` that was edited here rather than in the kit, and moves it to `<name>.local.bak` rather than dropping it. A rule worth keeping belongs in the kit, so every project gets it; `.claude/register.local.txt` is the place for something that is genuinely only true of Jean.

## 10. Writing

Short sentences. RFC 2119 keywords for obligations. Commit messages take an imperative subject; add a body only for a fact the diff cannot show.

**Write like a person, not like an assistant.** Code is the source of truth; prose exists to say what the code cannot. The register that makes documentation unreadable is a house of throat-clearing, elevated synonyms and hedges. `.claude/voice/register.txt` holds the words to avoid and the hook checks a subset of them.

The words are the easy half. What actually gives an assistant away is shape: an em dash at every joint, a bolded pronouncement opening every paragraph, and sentences that never vary in length. `.claude/voice/constructions.md` is that list, and it is the one worth reading twice.

Plain words over elevated ones. No selling to a reader who is already here. No sentence whose only job is to introduce the next one.

## 11. Tag hygiene is the library owner's business

Jean reads tags. It never writes or normalises them to make its own life easier. A genre spelled two ways is two rows in a list; the fix belongs in the player, where it sticks for every other client too.

## 12. Stack

React 19 · TypeScript 7 · Vite 8 · TanStack Query 5 · TanStack Virtual · TanStack Hotkeys · lucide-react · CSS Modules · Biome · pnpm · Playwright · `node --test`.

TypeScript is strict, in three scopes: `tsconfig.app.json` (the browser), `tsconfig.node.json` (the fake player, run by node stripping types, so imports name `.ts` explicitly and `erasableSyntaxOnly` makes an enum a compile error), and `tsconfig.test.json` (the specs). `pnpm build` typechecks before it bundles; Vite never does.

`noUncheckedIndexedAccess` is off: every read of a dictionary-encoded column or a typed array of refs is indexed by construction, so it would demand a guard on each one and teach nothing.

The unit tests run under node's own type stripping, with `test/alias.ts` loaded through `--import` as a module resolve hook. It teaches node three things the app relies on and node does not know: `@/` is Vite's alias for `src/`, imports there carry no extension, and the values Vite substitutes through `define` are globals rather than constants folded into a bundle. That is what lets a spec in `test/unit/` import a module out of `src/` directly, and it is why there is no bundler and no jsdom in the unit path.
