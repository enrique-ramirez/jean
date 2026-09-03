# Contributing

How to write code in this repo. To *use* Jean, read the [README](./README.md).

Three other documents, and they do not overlap: [API.md](./API.md) is the reference for what beefweb and foobar2000 return; [CLAUDE.md](./CLAUDE.md) holds what a coding agent cannot infer from the code, with a `CLAUDE.md` beside each part of the app for what is local to it; [test/README.md](./test/README.md) is the suite and the fake player.

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

The dev server binds on the LAN (`host: true`), so a phone can load `http://<your-machine>.local:8123` and hit the same proxy. The port is `strictPort`: `foo_jean` matches the dev origin against an exact allowlist, so sliding to the next free port would report the component unreachable with nothing on screen saying why.

## 2. The commands

```sh
pnpm dev            # dev server, HMR, /api proxied
pnpm build          # typecheck, then bundle into dist/
pnpm typecheck      # tsc across app, fake player and specs
pnpm lint           # biome check
pnpm lint:fix       # biome check --write
pnpm format         # biome format --write
pnpm test           # playwright, desktop and mobile
pnpm test:ui        # pick and watch tests interactively
pnpm fake           # the fake player alone, on :8880
pnpm demo           # build the live demo into dist-demo/
pnpm demo:preview   # serve that
```

`pnpm lint` and `pnpm typecheck` MUST pass. `pnpm test` MUST pass before a change is called done; see `test/README.md`.

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
  features/   one folder per thing a user can do: home, search, library, playlist,
              now-playing, queue, settings
  app/        the shell: App, Sidebar, CommandPalette, theme, hash routing
test/
  fake-api/   an in-memory foobar2000: portable route tables, plus the node
              sockets that serve them
  e2e/        the specs, in a real browser against that fake
demo/         the live demo -- the same fake, in a service worker
```

1. **Imports run one way: `app → features → domain → shared`.** Biome's `noRestrictedImports` enforces it per tier, so a violation fails `pnpm lint`.
2. Within `domain` the slices form a DAG (`library → track → player`). Sideways is allowed; a cycle is not.
3. Import anything outside its own folder through the `@/` alias (`@/domain/track/fields`). Same-folder imports stay relative.
4. A file whose home is unclear is usually in the wrong tier. Shared infrastructure is not a feature; a domain concept is not one view of it.

## 5. Naming

1. **Never name a store, a parser or a helper after the component beside it.** A case-insensitive filesystem cannot tell `toasts.ts` from `Toasts.tsx`, so TypeScript resolves `'./Toasts'` to the wrong file silently. Hence `toastStore.ts`, `lyricsFormat.ts`, `volumeScale.ts`.
2. **Never name a declaration file after the module beside it.** `fooJean.d.ts` next to `fooJean.ts` is read as that file's own declarations. The generated component types are `fooJeanSchema.d.ts`.
3. Components are `PascalCase.tsx`, hooks are `useThing.ts`, everything else is `camelCase.ts`.
4. Stylesheets are `Component.module.css`, beside the component.

## 6. Styling

1. **CSS Modules, colocated with the component.** The only global stylesheets are `shared/styles/tokens.css` (the palette and scale, as custom properties) and `base.css`. Re-theming Jean SHOULD mean editing about thirty custom properties and nothing else.
2. **A rule in one module that overrides another's MUST outrank it on specificity, never merely follow it.** Module order in the bundle follows import order, and import sorting can flip two rules of equal specificity.
3. Anything spatial belongs to a media query, not to a JS breakpoint flag.
4. Animate compositor properties only — `transform`, `scale`, `rotate`, `opacity`.

## 7. Comments

Comments are a **last resort**. Prefer an intention-revealing name, or extract a function whose name says what the comment would have said.

A comment is justified only when it records one of:

- a **trap** — something the next reader would otherwise revert into;
- an **external constraint** — what the player, the browser or a library actually does;
- a **non-obvious invariant** no name could carry.

Never narrate what the code does. Never date a comment, never sign one, never record what the code used to be. Git holds history.

Where a lint rule fires on something deliberate, the suppression carries its reason.

## 8. Writing

Short sentences. RFC 2119 keywords for obligations. Commit messages take an imperative subject; add a body only for a fact the diff cannot show.

## 9. Tag hygiene is the library owner's business

Jean reads tags. It never writes or normalises them to make its own life easier. A genre spelled two ways is two rows in a list; the fix belongs in the player, where it sticks for every other client too.

## 10. Stack

React 19 · TypeScript 7 · Vite 8 · TanStack Query 5 · TanStack Virtual · TanStack Hotkeys · lucide-react · CSS Modules · Biome · pnpm · Playwright.

TypeScript is strict, in three scopes: `tsconfig.app.json` (the browser), `tsconfig.node.json` (the fake player, run by node stripping types — imports name `.ts` explicitly and `erasableSyntaxOnly` makes an enum a compile error), and `tsconfig.test.json` (the specs). `pnpm build` typechecks before it bundles; Vite never does.

`noUncheckedIndexedAccess` is off: every read of a dictionary-encoded column or a typed array of refs is indexed by construction, so it would demand a guard on each one and teach nothing.
