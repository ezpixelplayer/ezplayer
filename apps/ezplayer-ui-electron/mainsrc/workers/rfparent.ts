import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlaylistSyncItem, RFApiClientConfig, RFWorkerInMessage, RFWorkerOutMessage } from './rfsync';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.resolve(__dirname, 'rfsync.js'); // compiled JS path
const worker = new Worker(workerPath);

worker.on('error', (err) => {
    console.error('Worker error:', err);
});

worker.on('exit', (code) => {
    console.log('Worker exited with code', code);
});

// rfParentExample.ts
worker.on("message", (msg: RFWorkerOutMessage) => {
  switch (msg.type) {
    case 'nextSuggestion': {
        // TODO
        break;
    }
    case "log":
      console[msg.level === "error" ? "error" : "log"]("[RFWorker]", msg.msg);
      break;

    case "configStatus":
      if (msg.ok) console.log("RF worker configured");
      else console.error("RF worker config error:", msg.error);
      break;

    case "playbackUpdated":
      console.log("RF playback updated:", msg);
      break;

    case "controlUpdated":
      console.log("RF control updated:", msg.enabled);
      break;

    case "playlistsSynced":
      console.log("RF playlists synced");
      break;

    case "heartbeatSent":
      if (msg.error) console.error("heartbeat error:", msg.error);
      break;
  }
});

function send(msg: RFWorkerInMessage) {
  worker.postMessage(msg);
}

export function setRFConfig(cfg: RFApiClientConfig) {
    worker.postMessage({
        type: 'setConfig',
        config: cfg,
    } satisfies RFWorkerInMessage);
}

export function setRFNowPlaying(now?: string, next?: string) {
    send({
        type: "updatePlayback",
        nowPlaying: now,
        nextScheduled: next,
    });
}

export function setRFControlEnabled(enabled: boolean) {
    send({ type: "setControlEnabled", enabled});
}

export function setRFPlaylist(pl: PlaylistSyncItem[]) {
    send({
    type: "syncPlaylists",
    playlists: [
        {
        playlistName: "Song1",
        playlistDuration: 120,
        playlistIndex: 1,
        playlistType: "SEQUENCE",
        },
    ],
    });
}

export function sendRFInitiateCheck() {
    send({
        type: 'requestNextSuggestion',
    })
}