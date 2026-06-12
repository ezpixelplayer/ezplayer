## The tech stack

- **Node.js + Electron** desktop app (Windows, macOS, Linux)
- **React** UI; a **Koa** REST server in a worker thread serves the LAN/web UI
- Same JavaScript core drives the Electron app and the web view
- Cross-platform from one codebase

<!-- Electron ^40, React ^18.3, Koa worker thread (see dev/koa-apis.md) -->
