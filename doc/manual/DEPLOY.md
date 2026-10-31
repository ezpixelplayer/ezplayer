# Deploying the manual

The manual is a static Docusaurus site hosted on **Cloudflare Pages** at
**https://ezplayer.dev** (it is the main site; `docs.ezplayer.dev` and
`www.ezplayer.dev` 301 to it via Cloudflare Redirect Rules). The `ezplayer.dev` DNS zone is on **Cloudflare**
(registrar is GoDaddy), so zone-level Cloudflare settings — Managed robots.txt,
Block AI bots, etc. — apply to the manual as well as the WordPress site.

`doc/manual/docusaurus.config.js` sets `url: 'https://ezplayer.dev'` and
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

## Custom domain

1. In the Pages project → **Custom domains → Set up a domain**, add
   `ezplayer.dev`, `www.ezplayer.dev`, and `docs.ezplayer.dev`. Because the
   zone is on Cloudflare, it offers to create/replace the DNS records itself
   (apex via CNAME flattening); accept. TLS is issued within minutes.
2. **Rules → Redirect Rules**: one dynamic rule, hostname `docs.ezplayer.dev`
   or `www.ezplayer.dev` → `concat("https://ezplayer.dev", http.request.uri.path)`,
   301, preserve query string. Pages custom domains must stay attached so the
   hostnames are proxied and the rule can fire.
3. Old WordPress paths (`/faq`, `/forum`, `/news`, ...) are mapped in
   `static/_redirects`, which Pages applies at the edge.
4. **Security → Bots** (or **AI Crawl Control**): leave *Block AI bots* and
   *Managed robots.txt* off; the manual is CC BY-SA and meant to be read by
   assistants. The site's own `static/robots.txt` advertises the sitemap.
5. **Google Search Console**: domain property `ezplayer.dev` (DNS TXT via
   Cloudflare DNS), submit `https://ezplayer.dev/sitemap.xml`.

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
