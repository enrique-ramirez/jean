# Contributing

How to write the web UI's code. The root [CONTRIBUTING.md](../CONTRIBUTING.md) holds the rules the whole repository shares.

[ARCHITECTURE.md](./ARCHITECTURE.md) is how the pieces fit and why the boundaries sit where they do, [src/shared/api/README.md](src/shared/api/README.md) is what `foo_jean` returns, and [test/README.md](./test/README.md) is the suite and the fake player.

## 1. The development loop

You do not deploy to a player to develop. Jean is a static SPA that talks to `foo_jean` over HTTP; a build does not need to be served by it. Vite proxies `/api` to a real player, so the app is same-origin, there is no CORS to configure, and nothing changes on the player side.

```sh
pnpm install
pnpm dev            # http://localhost:8123
```

Point it at a player with `FOO_JEAN_URL`, in the environment or in `.env.local` (copy `.env.example`):

```sh
FOO_JEAN_URL=http://<player-host>:8881 pnpm dev
```

A player behind HTTPS works too, `FOO_JEAN_URL=https://<player-host>`. Node trusts only its own bundled certificate authorities unless told otherwise, so `pnpm dev` starts it with `--use-system-ca`, and a certificate the operating system trusts, a private CA included, is accepted by the proxy as well.

The dev server binds on the LAN (`host: true`), so a phone can load it and hit the same proxy. The port is `strictPort`, so it is predictable: a phone typing the address or a bookmark does not go looking for whichever port happened to be free.

No player in reach? `pnpm fake` serves the in-memory one on `:8881`, and `FOO_JEAN_URL=http://localhost:8881 pnpm dev` points at it.

## 2. The commands

```sh
pnpm dev            # dev server, HMR, /api proxied
pnpm build          # typecheck, then bundle into dist/
pnpm preview        # serve that build
pnpm typecheck      # tsc across every package
pnpm lint           # biome check
pnpm lint:fix       # biome check --write
pnpm format         # biome format --write
pnpm test           # test:unit, then test:e2e
pnpm test:unit      # node --test, every package
pnpm test:e2e       # playwright, desktop and mobile
pnpm test:ui        # pick and watch tests interactively
pnpm test:live      # the small suite against a real player. Needs LIVE
pnpm test:iphone    # the @iphone subset under WebKit, run by nothing else
pnpm test:contract  # drive a running plugin against the specification. Needs CONTRACT_URL
pnpm fake           # the fake player alone, on :8881
pnpm demo           # build the live demo into dist-demo/
pnpm demo:preview   # serve that
pnpm site           # build the landing page into site/dist-site/
pnpm site:preview   # serve that
pnpm types:api      # regenerate the typed client from the specification
pnpm sync-kit       # refresh .claude/ from the ai-engineering kit
```

`pnpm lint` and `pnpm typecheck` MUST pass. Both are seconds; run them freely. `pnpm test:unit` is nearly as cheap.

**`pnpm test:e2e` is not.** A full Playwright run is desktop and mobile across the whole suite: it loads the machine and floods an agent's context. Run the specs that cover what you changed, such as `pnpm test:e2e test/e2e/queue.spec.ts`, `--grep "toast"` or `--project=desktop`, as often as you like. Keep the full run as a final verification, once, when the change is substantial enough that something outside the specs you already ran could plausibly have broken. Changes to documentation, comments or configuration need no run at all. See `test/README.md`.

A source file containing a NUL byte is binary to `grep`, which matches nothing in it and exits non-zero, so a check built on `grep` (`.claude/hooks/check-style.sh` included) passes every line of it. `file` naming a `.ts` as `data` is the tell, and a separator written as the byte rather than as `\u0000` is how it gets in.

## 3. Where things live

**Imports run one way: `app → features → domain → shared`, and Biome fails the build on a violation.** [ARCHITECTURE.md](./ARCHITECTURE.md), *Tiers*, is what each tier may know about, the rest of the direction rules, and why the boundaries sit where they do; it also has where state lives and what the two optional-component seams are.

Commands run from the repository root and the root `package.json` delegates them, so nothing here needs running from inside `ui/`.

## 4. Naming

1. **Never name a store, a parser or a helper after the component beside it.** A case-insensitive filesystem cannot tell `toasts.ts` from `Toasts.tsx`, so TypeScript resolves `'./Toasts'` to the wrong file silently. Hence `toastStore.ts`, `lyricsFormat.ts`, `volumeScale.ts`.
2. **Never name a declaration file after the module beside it.** `playlists.d.ts` next to `playlists.ts` is read as that file's own declarations. The generated component types are `fooJeanSchema.d.ts`.
3. Components are `PascalCase.tsx`, hooks are `useThing.ts`, everything else is `camelCase.ts`.
4. Stylesheets are `Component.module.css`, beside the component.

## 5. Styling

1. **CSS Modules, colocated with the component.** The only global stylesheets are `shared/styles/tokens.css` (the palette and scale, as custom properties) and `base.css`. Re-theming Jean SHOULD mean editing custom properties and nothing else.
2. **A class passed into a shared component wins by cascade layer, whatever either rule's specificity or place in the bundle.** A stylesheet under `shared/ui/` or `shared/keyboard/`, and `hitArea.module.css`, is one `@layer shared` block. `base.css` keeps its element rules and the focus ring in `@layer base`, beneath it. `domain/`, `features/` and `app/` stay unlayered, which outranks both.
   - The caller's plain rule also replaces the component's `:hover`, `:disabled` and `:focus-visible` rule for the same property. Restate the state where it is still wanted.
   - A layered stylesheet opens with `@layer base, shared;`. Any chunk can be the first one the browser reads, and an order stated after a layered rule does not reorder it.
   - Nothing in a layer is `!important`, which inverts the order.
   - Layers do not settle two unlayered modules. There the overriding rule MUST outrank the other on specificity, with a parent class in its selector, never merely follow it: module order in the bundle follows import order, and import sorting can flip two rules of equal specificity.

   `test/unit/cascadeLayers.test.ts` holds the arrangement: which layer each stylesheet's rules are in, the opening statement, and no `!important` in a layer.
3. **Within one stylesheet, rules ascend in specificity**, so the file reads in the order the cascade applies it. `noDescendingSpecificity` fails the lint on a rule that undoes a more specific one above it.
4. Anything spatial belongs to a media query, not to a JS breakpoint flag.
5. Animate compositor properties only, `transform`, `scale`, `rotate` and `opacity`, plus a colour on a control's own box. Never a layout property, a shadow, `border-radius` or `background-position`; `test/unit/animatedProperties.test.ts` reads every stylesheet for one.
6. **A new stacking layer goes in the table in `ARCHITECTURE.md` before it goes in a stylesheet.** The app-level scale is shared by everything, and picking a number without reading it is how a dialog ends up under a toolbar.

## 6. Phrases

1. **Every phrase a person reads goes through `t()`**, keyed in `src/shared/i18n/en.ts`. Keys are flat, dotted and sorted, and the prefix names the area rather than the file.
2. **A key chosen at runtime is typed narrower than `Phrase`**, through a template-literal `Extract` beside whatever holds it (`ShortcutName`, `ColumnLabel`, `DetailPhrase`). `t()` derives its arguments from the key, so the whole union demands every phrase's fields. A family that takes fields stays out of such a union.
3. **A sentence with something drawn inside it is one phrase**, rendered through `<Trans>`, so word order stays the translator's.
4. **Plurals come from the catalogue.** A value written as an object is selected by `Intl.PluralRules` on `count`, and `other` is the only form required.
5. **Figures and dates go through `useFormats()`**, never `toLocaleString()` or a bare `Intl` constructor, which follow the browser rather than the language showing. Sorting and grouping go through `collatorIn`.
6. **`t()` is for what is drawn, and once a year it respells the word play.** An `aria-label` or a `title` that carries that word goes through `useSpoken()`, which is the catalogue as written on any day.

## 7. Comments

A fact about the player that governs several files goes in `src/shared/api/README.md`; one about the browser goes in `ARCHITECTURE.md`, *Facts about the browser*. The files depending on either say nothing.

Read the `useExhaustiveDependencies` suppressions before running `lint:fix`, which would remove every one and break the feature silently; the root `CLAUDE.md` has the one shape they all take.

## 8. Tag hygiene is the library owner's business

Jean reads tags. It never writes or normalises them to make its own life easier. A genre spelled two ways is two rows in a list; the fix belongs in the player, where it sticks for every other client too.

## 9. Stack

React 19 · TypeScript 7 · Vite 8 · TanStack Query 5 · TanStack Virtual · TanStack Hotkeys · lucide-react · CSS Modules · Biome · pnpm · Playwright · `node --test`.

TypeScript is strict, in three scopes: `tsconfig.app.json` (the browser), `tsconfig.node.json` (the fake player, run by node stripping types, so imports name `.ts` explicitly and `erasableSyntaxOnly` makes an enum a compile error), and `tsconfig.test.json` (the specs). `pnpm build` typechecks before it bundles; Vite never does.

`noUncheckedIndexedAccess` is off: every read of a dictionary-encoded column is indexed by construction.

The unit tests run under node's own type stripping rather than a bundler, which is what `test/alias.ts` is for; `test/README.md` has what it teaches node and why there is no jsdom anywhere.
