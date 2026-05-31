# EZPlayer documentation

All documentation lives here as git artifacts, built with a small toolchain:

- **[marp](https://marp.app/)** — slide decks (assembled from reusable fragments)
- **[Docusaurus](https://docusaurus.io/)** — the manual (public)
- **[d2](https://d2lang.com/)** — diagrams, compiled to SVG and shared by both

```
doc/
  assets/                 # shared assets used by slides AND the manual
    diagrams/*.d2         #   d2 sources (source of truth); *.svg is generated
    img/                  #   shared images
  slides/
    build-tool/           # the deck builder (public, generic)
      build.mjs           #   manifest -> assembled deck -> marp
      compile-diagrams.mjs#   d2 -> svg (also used by the manual)
      roots.yaml          #   logical-root -> physical-path map (the only path-aware file)
      themes/             #   marp themes
    fragments/            # reusable slide fragments
      shared/
      dev/
    decks/                # deck manifests (ordered lists of fragments)
    build/                # assembled decks (generated, gitignored)
  manual/                 # Docusaurus site (public manual)
```

## Slides

Slide decks are built by composing reusable markdown pieces into your favorite format (PDF, html, etc.).

This allows:
- Simple editing, version controlled, effective across all uses
- Decks for casual user presentations, or within developer presentations, sharing as possible
- A mix of personal slides ("About The Presenter") with the shared slides

### Slide Decks
A **deck** is a manifest: an ordered list of **fragments**, each named by a
**logical root** (`shared/…`, `dev/…`, and — in a personal repo — `personal/…`).
`roots.yaml` is the only file that knows where those roots physically live, so
the same build tool composes public-only decks here and public+personal decks
from a sibling personal repo.

```bash
cd doc/slides/build-tool
npm install                              # once
npm run user-talk                        # build the end-user deck
npm run dev-talk                         # build the developer deck
node build.mjs ../decks/dev-talk.yaml --pdf   # also emit a PDF
```

Output lands in `doc/slides/build/<deck-name>/<deck-name>.html`.

### Reuse across decks, and personal slides

Decks share fragments simply by listing the same `shared/…` entries. To keep
some slides in a separate repository:

1. In a **separate repo**, check it out as a sibling of this one.
2. Add a `roots.yaml` there that maps `shared`/`dev`/`assets` back to this repo
   (e.g. `shared: ../../ezplayer/doc/slides/fragments/shared`) and adds
   `personal:` and `personalassets:` roots pointing at the personal repo's own files.
3. Put personal fragments (e.g. `about-me.md`) and personal assets (show photos)
   in the personal repo, and write deck manifests there that interleave them
   with the shared fragments.
4. Build with this repo's tool: `node .../build-tool/build.mjs <personal-deck> --roots <personal-roots.yaml>`.

Asset namespaces (`assets`, `personalassets`, …) are each copied into the build dir
under their own name, so public diagrams and personal photos coexist without
path collisions. Fragments reference them relatively, e.g.
`![](assets/diagrams/arch-simple.svg)` or `![](personalassets/2024-show.jpg)`.

## Manual

```bash
cd doc/manual
npm install            # once
npm start              # dev server (recompiles diagrams first)
npm run build          # static build into doc/manual/build
```

The manual serves `doc/assets/` directly (via `staticDirectories`), so a d2
diagram at `doc/assets/diagrams/arch-simple.svg` is referenced as
`/diagrams/arch-simple.svg`. `npm start`/`npm run build` recompile the d2
sources first via the shared `compile-diagrams.mjs`.

## Diagrams

```bash
cd doc/slides/build-tool
npm run diagrams           # compile all d2 under doc/assets
```

Edit the `.d2` sources; the `.svg` files are generated and gitignored. The deck
builder and the manual both run this step automatically, so you only need it
when you want to preview a diagram change on its own.
