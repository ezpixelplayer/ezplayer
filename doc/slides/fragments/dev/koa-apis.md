## The Koa REST API

![w:820](assets/diagrams/ezp-arch-dev.svg)

A **Koa server runs in a worker thread** inside the player and exposes the
show over HTTP:

- `GET /api/hello` — health check
- `GET /api/current-show` — full player state (sequences, playlists, schedule)
- `GET /api/getimage/:sequenceId` — sequence thumbnails

> Full reference lives in the manual under **Reference → API**.
