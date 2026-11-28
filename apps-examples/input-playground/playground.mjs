// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Input Playground, an EZPlayer app.
 *
 * The app's page is a screen of pretend show inputs. Each tap, flip, drag or Enter
 * arrives here as an app event, and for every one this process makes the HTTP call
 * a real controller board (Baldrick Input8, Falcon, FPP) would make to the player's
 * show-inputs endpoint, POST or GET /api/ezp/inputs/<source>/<name>. The Apps card's
 * mapping table then routes it to whatever instance input the owner wired it to, so
 * mappings can be tried before any hardware exists.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * The layout comes from the instance's private data key "layout".
 */

const base = (process.env.EZP_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const instance = process.env.EZP_APP_INSTANCE;
const token = process.env.EZP_APP_TOKEN;
if (!instance || !token) {
    console.error('EZP_APP_INSTANCE and EZP_APP_TOKEN must be set (this program is started by the player)');
    process.exit(1);
}

const authHeaders = { 'x-ezp-app-token': token };
const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };
const appUrl = (path) => `${base}/api/ezp/apps/${encodeURIComponent(instance)}${path}`;

/** Resolves after `ms`, or at once when `signal` fires. */
const sleep = (ms, signal) =>
    new Promise((resolve) => {
        const t = setTimeout(done, ms);
        function done() {
            clearTimeout(t);
            signal?.removeEventListener('abort', done);
            resolve();
        }
        if (signal?.aborted) done();
        else signal?.addEventListener('abort', done);
    });

// ---- Layout ----

// The same rule the player applies to /api/ezp/inputs/:source/:name.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TYPES = ['button', 'switch', 'slider', 'text'];
const SHAPES = ['round', 'square', 'wide'];
const MODES = ['press', 'press-release'];
const RECENT_MAX = 30;

const DEFAULT_LAYOUT = {
    source: 'playground',
    cols: 4,
    controls: [
        { type: 'button', name: 'button1', label: 'Start', color: '#ff2a2a', shape: 'round', mode: 'press' },
        { type: 'button', name: 'button2', label: 'Stop', color: '#e8ebf2', shape: 'round', mode: 'press' },
        { type: 'button', name: 'button3', label: 'Next', color: '#2a9dff', shape: 'square', mode: 'press' },
        { type: 'button', name: 'button4', label: 'Back', color: '#2a9dff', shape: 'square', mode: 'press' },
        { type: 'button', name: 'button5', label: 'Red', color: '#ff2a2a', shape: 'square', mode: 'press' },
        { type: 'button', name: 'button6', label: 'Green', color: '#2aff5a', shape: 'square', mode: 'press' },
        { type: 'button', name: 'button7', label: 'Blue', color: '#4a6aff', shape: 'square', mode: 'press' },
        {
            type: 'button',
            name: 'button8',
            label: 'Hold to fire',
            color: '#ffb52a',
            shape: 'wide',
            mode: 'press-release',
        },
        { type: 'switch', name: 'switch1', label: 'Snow machine' },
        { type: 'switch', name: 'switch2', label: 'House lights' },
        { type: 'slider', name: 'slider1', label: 'Brightness', min: 0, max: 1, step: 0.01 },
        { type: 'slider', name: 'slider2', label: 'Speed', min: 0, max: 100, step: 1 },
        { type: 'text', name: 'text1', label: 'Marquee message' },
    ],
};

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Turns whatever the owner saved into a layout the page can render and the player
 * will accept. Bad controls are dropped, not fatal; nothing usable means the default.
 * Returns { layout, problems }.
 */
function normalizeLayout(raw) {
    const problems = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { layout: clone(DEFAULT_LAYOUT), problems: ['layout must be a JSON object; using the default'] };
    }
    let source = DEFAULT_LAYOUT.source;
    if (typeof raw.source === 'string' && NAME_RE.test(raw.source)) source = raw.source;
    else if (raw.source !== undefined) {
        problems.push(`source must be lower-case letters, digits and dashes (up to 40); using "${source}"`);
    }
    const cols = Math.min(8, Math.max(1, Math.round(num(raw.cols, DEFAULT_LAYOUT.cols))));

    const controls = [];
    const seen = new Set();
    if (!Array.isArray(raw.controls)) problems.push('controls must be an array');
    else {
        raw.controls.forEach((c, i) => {
            const where = `controls[${i}]`;
            if (!c || typeof c !== 'object') return problems.push(`${where}: not an object; dropped`);
            if (!TYPES.includes(c.type))
                return problems.push(`${where}: type must be one of ${TYPES.join(', ')}; dropped`);
            if (typeof c.name !== 'string' || !NAME_RE.test(c.name)) {
                return problems.push(
                    `${where}: name must be lower-case letters, digits and dashes (up to 40); dropped`,
                );
            }
            if (seen.has(c.name)) return problems.push(`${where}: duplicate name "${c.name}"; dropped`);
            seen.add(c.name);
            const label = typeof c.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 40) : c.name;
            const out = { type: c.type, name: c.name, label };
            if (c.type === 'button') {
                out.color =
                    typeof c.color === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c.color)
                        ? c.color
                        : '#4cc9f0';
                out.shape = SHAPES.includes(c.shape) ? c.shape : 'square';
                out.mode = MODES.includes(c.mode) ? c.mode : 'press';
            } else if (c.type === 'slider') {
                let min = num(c.min, 0);
                let max = num(c.max, 1);
                let step = num(c.step, 0.01);
                if (!(max > min) || !(step > 0)) {
                    problems.push(`${where}: slider needs min < max and step > 0; using 0 to 1 by 0.01`);
                    [min, max, step] = [0, 1, 0.01];
                }
                Object.assign(out, { min, max, step });
            }
            controls.push(out);
        });
    }
    if (!controls.length) {
        problems.push('no usable controls; using the default layout');
        return { layout: clone(DEFAULT_LAYOUT), problems };
    }
    return { layout: { source, cols, controls }, problems };
}

/** The saved layout, normalized; the default when the key is missing. */
async function loadLayout() {
    const res = await fetch(appUrl('/data/private/layout'), { headers: authHeaders });
    if (res.status === 404) return { layout: clone(DEFAULT_LAYOUT), from: 'default', problems: [] };
    if (!res.ok) throw new Error(`layout: HTTP ${res.status}`);
    const { layout, problems } = normalizeLayout(await res.json());
    return { layout, from: 'saved', problems };
}

// ---- Main ----

async function main() {
    const stopping = new AbortController();
    const quit = () => stopping.abort();
    process.on('SIGTERM', quit);
    process.on('SIGINT', quit);
    const signal = stopping.signal;

    let layout = clone(DEFAULT_LAYOUT);
    let layoutFrom = 'default';
    let layoutProblems = [];
    let layoutError = '';
    const recent = [];
    const counts = { sent: 0, delivered: 0, failed: 0 };
    let presses = 0;
    let lastPublishAt = 0;

    const controlByName = () => new Map(layout.controls.map((c) => [c.name, c]));

    const publish = async (phase = 'ready') => {
        lastPublishAt = Date.now();
        const status = {
            phase,
            source: layout.source,
            controls: layout.controls.map((c) => c.name),
            layout,
            layoutFrom,
            layoutProblems,
            layoutError,
            recent,
            counts,
        };
        await fetch(appUrl('/status'), { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(status) }).catch(
            () => undefined,
        );
    };

    /**
     * The controller-style call: no app token, no instance, just what a board would send.
     * Alternate presses use the GET form so both shapes get exercised (a GET value arrives
     * at the mapped app as the string "1", a POST value as the number 1).
     */
    const callInput = async (kind, name, value, method) => {
        const path = `/api/ezp/inputs/${layout.source}/${name}`;
        let url = `${base}${path}`;
        let init;
        let shown;
        if (method === 'GET') {
            const q = `?value=${encodeURIComponent(String(value))}`;
            url += q;
            init = { method: 'GET', headers: authHeaders };
            shown = `GET ${path}${q}`;
        } else {
            const body = JSON.stringify({ value });
            init = { method: 'POST', headers: jsonHeaders, body };
            shown = `POST ${path} ${body}`;
        }
        const entry = { at: Date.now(), name, kind, method, call: shown, value, status: 0, delivered: null };
        counts.sent++;
        try {
            const res = await fetch(url, init);
            entry.status = res.status;
            const answer = await res.json().catch(() => null);
            if (res.ok && answer?.ok) {
                entry.delivered = typeof answer.delivered === 'number' ? answer.delivered : 0;
                if (entry.delivered > 0) counts.delivered++;
            } else {
                entry.error = answer?.error ?? `HTTP ${res.status}`;
                counts.failed++;
            }
        } catch (e) {
            entry.error = e.message;
            counts.failed++;
        }
        recent.unshift(entry);
        if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
        console.log(`${shown} -> ${entry.status}${entry.error ? ` ${entry.error}` : ` delivered: ${entry.delivered}`}`);
        await publish();
    };

    const handleEvent = async (ev) => {
        const d = ev?.data;
        if (!d || typeof d !== 'object' || typeof d.name !== 'string') return;
        const control = controlByName().get(d.name);
        if (!control) return console.log(`event for unknown control "${d.name}" ignored`);
        switch (d.type) {
            case 'press':
                if (control.type !== 'button') return;
                return callInput('press', d.name, 1, presses++ % 2 === 0 ? 'POST' : 'GET');
            case 'release':
                if (control.type !== 'button' || control.mode !== 'press-release') return;
                return callInput('release', d.name, 0, 'POST');
            case 'set':
                if (control.type === 'switch' && typeof d.value === 'boolean')
                    return callInput('set', d.name, d.value, 'POST');
                if (control.type === 'slider' && typeof d.value === 'number' && Number.isFinite(d.value)) {
                    const v = Math.min(control.max, Math.max(control.min, d.value));
                    return callInput('set', d.name, v, 'POST');
                }
                return;
            case 'text':
                if (control.type !== 'text' || typeof d.value !== 'string') return;
                return callInput('text', d.name, d.value.slice(0, 1000), 'POST');
            default:
                return;
        }
    };

    const pollEvents = async () => {
        let since = 0;
        while (!signal.aborted) {
            try {
                const res = await fetch(appUrl(`/events?since=${since}&wait=30`), { headers: authHeaders, signal });
                if (!res.ok) throw new Error(`events: HTTP ${res.status}`);
                const { events = [] } = await res.json();
                for (const ev of events) {
                    since = Math.max(since, ev.id);
                    await handleEvent(ev);
                }
            } catch (e) {
                if (signal.aborted) return;
                console.log(`events: ${e.message}`);
                await sleep(2000, signal);
            }
        }
    };

    // The owner edits the layout on the config page; pick it up without a restart.
    const watchLayout = async () => {
        let lastJson = '';
        while (!signal.aborted) {
            try {
                const l = await loadLayout();
                layout = l.layout;
                layoutFrom = l.from;
                layoutProblems = l.problems;
                layoutError = '';
            } catch (e) {
                layoutError = `Player not reachable: ${e.message}`;
            }
            const json = JSON.stringify([layout, layoutFrom, layoutProblems, layoutError]);
            if (json !== lastJson) {
                lastJson = json;
                for (const p of layoutProblems) console.log(`layout: ${p}`);
                console.log(
                    layoutError ||
                        `layout (${layoutFrom}): source "${layout.source}", ${layout.controls.length} controls`,
                );
                await publish();
            }
            await sleep(5000, signal);
        }
    };

    const heartbeat = async () => {
        while (!signal.aborted) {
            await sleep(2000, signal);
            if (!signal.aborted && Date.now() - lastPublishAt >= 2000) await publish();
        }
    };

    await Promise.all([pollEvents(), watchLayout(), heartbeat()]);
    await publish('stopped');
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
