# Deploying the manual

The manual is a static Docusaurus site hosted on **Cloudflare Pages** at
**https://docs.ezplayer.dev**. DNS for `ezplayer.dev` is managed at **GoDaddy**.

`doc/manual/docusaurus.config.js` sets `url: 'https://docs.ezplayer.dev'` and
`baseUrl: '/'` — keep those in sync with wherever the site actually lives
(canonical URLs, sitemap, and OG tags depend on `url`).

## Build

`npm run build` (inside `doc/manual`) runs a `prebuild` that compiles the d2
diagrams via `../slides/build-tool/compile-diagrams.mjs`. That script imports
`@terrastruct/d2` from the **sibling** `doc/slides/build-tool` package, not from
`doc/manual`. So any build environment must install **both** packages, and the
generated `*.svg`s are gitignored (they are produced at build time).

Output is written to `doc/manual/build`.

## Cloudflare Pages — Git integration (recommended)

No deploy token lives in the repo or in GitHub secrets: Cloudflare's own GitHub
app pulls the source and builds on Cloudflare's infrastructure. Push to `main`
→ Cloudflare builds → deploys.

In the Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to
Git**, select this repo, then set:

| Setting                | Value                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| Production branch      | `main`                                                                     |
| Root / base directory  | repository root (so the build can reach both `doc/manual` and `doc/slides`) |
| Build command          | `(cd doc/slides/build-tool && npm ci) && (cd doc/manual && npm ci && npm run build)` |
| Build output directory | `doc/manual/build`                                                         |

Deploy once so the project's `*.pages.dev` hostname exists.

## Custom domain (Cloudflare + GoDaddy)

1. In the Pages project → **Custom domains → Set up a domain** →
   `docs.ezplayer.dev`. Cloudflare shows a CNAME target like
   `ezplayer-docs.pages.dev` and marks the domain **pending**.
2. In **GoDaddy DNS**, add a record:
   - **Type:** `CNAME`
   - **Name / Host:** `docs`
   - **Value:** the `<project>.pages.dev` hostname Cloudflare gave you
3. Wait for propagation. Cloudflare validates the CNAME and issues the TLS
   certificate automatically (usually minutes); the domain flips to **active**.

`docs.ezplayer.dev` is a subdomain, so a plain CNAME works even though DNS is at
GoDaddy — no need to move the zone to Cloudflare. (An apex CNAME on
`ezplayer.dev` itself would be a problem; a subdomain is not.)

Finally, link `ezplayer.dev` to `docs.ezplayer.dev` from the main site.

## Alternative — direct upload (no Git integration)

Build locally (where both packages are already installed) and push the static
output with Wrangler. This sidesteps the CI dependency wiring entirely:

```bash
cd doc/manual
npm run build
npx wrangler pages deploy build --project-name ezplayer-docs
```

Wrangler prompts for Cloudflare auth on first use; the credential stays on the
maintainer's machine (nothing is stored in the repo). Add the custom domain the
same way as above.
