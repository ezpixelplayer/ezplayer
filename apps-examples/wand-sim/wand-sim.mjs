// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Wand Simulator, as an EZPlayer app.
 *
 * Stands in for the RF wand and its base stations. The app's page is a joystick that
 * walks the holder around, a dome that aims the wand, and a button for the beam. Every
 * pose the page reports goes to the player's show inputs the way a base station would
 * send it:
 *
 *     POST /api/ezp/inputs/<source>/pose   { "value": { "x", "z", "yaw", "pitch", "on" } }
 *
 * with x and z in meters (x right, z toward the holder's back), yaw and pitch in degrees
 * (yaw 0 faces the display, pitch up), and on true while the beam is lit. The Apps card's
 * mapping table routes that to the Tag the Monsters instance's `pose` input; when the real
 * base station arrives, the mapping row changes and nothing else does.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * Settings (private data key "settings"): source (default "wand-sim"), rateHz (default 20).
 */

const base = (process.env.EZP_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const instance = process.env.EZP_APP_INSTANCE;
const token = process.env.EZP_APP_TOKEN;
if (!instance || !token) {
    console.error('EZP_APP_INSTANCE and EZP_APP_TOKEN must be set (this program is started by the player)');
    process.exit(1);
}

const authHeaders = { 'x-ezp-app-token': token };
const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };
const appUrl = (path) => `${base}/api/ezp/apps/${encodeURIComponent(instance)}${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The same rule the player applies to /api/ezp/inputs/:source/:name.
const SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/;

let settings = { source: 'wand-sim', rateHz: 20 };
let settingsJson = '';
let quit = false;

const pose = { x: 0, z: 0, yaw: 0, pitch: 10, on: false };
let poseDirty = false;
let lastSentAt = 0;
let lastSentJson = '';
const counts = { received: 0, sent: 0, delivered: 0, failed: 0 };
let lastError = '';
let lastDelivered = null;
let publishDirty = true;
let lastPublish = 0;

function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const source = typeof r.source === 'string' && SOURCE_RE.test(r.source) ? r.source : 'wand-sim';
    const rateHz = typeof r.rateHz === 'number' && Number.isFinite(r.rateHz) ? Math.min(30, Math.max(1, r.rateHz)) : 20;
    return { source, rateHz };
}

async function refreshSettings() {
    try {
        const res = await fetch(appUrl('/data/private/settings'), { headers: authHeaders });
        if (res.status !== 404 && !res.ok) throw new Error(`settings: HTTP ${res.status}`);
        const next = normalize(res.status === 404 ? {} : await res.json());
        const json = JSON.stringify(next);
        if (json !== settingsJson) {
            settingsJson = json;
            settings = next;
            publishDirty = true;
        }
    } catch (e) {
        lastError = `Player not reachable: ${e.message}`;
    }
}

/** The controller-style call: no app token, no instance, just what a base station would send. */
async function sendPose() {
    const value = { x: round(pose.x, 3), z: round(pose.z, 3), yaw: round(pose.yaw, 1), pitch: round(pose.pitch, 1), on: pose.on };
    const body = JSON.stringify({ value });
    lastSentJson = body;
    lastSentAt = Date.now();
    counts.sent++;
    try {
        const res = await fetch(`${base}/api/ezp/inputs/${settings.source}/pose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        const answer = await res.json().catch(() => null);
        if (res.ok && answer?.ok) {
            lastDelivered = typeof answer.delivered === 'number' ? answer.delivered : 0;
            if (lastDelivered > 0) counts.delivered++;
            lastError = '';
        } else {
            counts.failed++;
            lastError = answer?.error ?? `HTTP ${res.status}`;
        }
    } catch (e) {
        counts.failed++;
        lastError = e.message;
    }
    publishDirty = true;
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function handleEvent(ev) {
    const d = ev?.data;
    if (!d || typeof d !== 'object' || d.type !== 'pose') return;
    const v = d.value;
    if (!v || typeof v !== 'object') return;
    pose.x = num(v.x, pose.x, -1000, 1000);
    pose.z = num(v.z, pose.z, -1000, 1000);
    pose.yaw = num(v.yaw, pose.yaw, -720, 720);
    pose.pitch = num(v.pitch, pose.pitch, -90, 90);
    pose.on = v.on === true;
    counts.received++;
    poseDirty = true;
}

async function pollEvents() {
    let since = 0;
    while (!quit) {
        try {
            const res = await fetch(appUrl(`/events?since=${since}&wait=30`), { headers: authHeaders });
            if (!res.ok) throw new Error(`events: HTTP ${res.status}`);
            const { events = [] } = await res.json();
            for (const ev of events) {
                since = Math.max(since, ev.id);
                handleEvent(ev);
            }
        } catch (e) {
            if (quit) return;
            console.log(`events: ${e.message}`);
            await sleep(2000);
        }
    }
}

async function publish() {
    const now = Date.now();
    if (!publishDirty && now - lastPublish < 1000) return;
    if (now - lastPublish < 200) return;
    lastPublish = now;
    publishDirty = false;
    const status = {
        source: settings.source,
        rateHz: settings.rateHz,
        path: `/api/ezp/inputs/${settings.source}/pose`,
        pose: { ...pose },
        counts: { ...counts },
        lastDelivered,
        lastSentJson,
        lastError,
    };
    await fetch(appUrl('/status'), { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(status) }).catch(() => undefined);
}

async function main() {
    console.log(`Wand Simulator: instance ${instance} at ${base}`);
    await refreshSettings();
    void pollEvents();
    let lastSettings = 0;
    while (!quit) {
        const now = Date.now();
        if (now - lastSettings > 2000) {
            lastSettings = now;
            await refreshSettings();
        }
        // At most rateHz poses a second while the page moves, and one a second while it holds still,
        // so the game's staleness check keeps seeing a live wand.
        const interval = 1000 / settings.rateHz;
        if ((poseDirty && now - lastSentAt >= interval) || (lastSentJson && now - lastSentAt >= 1000)) {
            poseDirty = false;
            await sendPose();
        }
        await publish();
        await sleep(10);
    }
}

process.on('SIGINT', () => { quit = true; process.exit(0); });
process.on('SIGTERM', () => { quit = true; process.exit(0); });

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
