// The script every app page loads with `<script src="_sdk.js">`, relative to the page. The player
// serves it at any path under an app instance, and the cloud forwards it. The page URL alone cannot
// say whether it is on the LAN (/apps/<instance>/…) or on the show's cloud page
// (/apps/<slug>/<instance>/…), so the SDK asks: `_context.json` next to itself is answered by the
// player on the LAN and by the cloud through the bridge.

export const APPS_SDK_JS = String.raw`(function () {
  'use strict';
  var script = document.currentScript;
  var src = (script && script.src) || (location.origin + location.pathname.replace(/[^/]*$/, '') + '_sdk.js');
  var dir = src.replace(/[^/]*$/, '');
  var ctxUrl = dir + '_context.json';

  function clientId() {
    try {
      var id = localStorage.getItem('ezapp.client');
      if (!id) {
        id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('ezapp.client', id);
      }
      return id;
    } catch (e) {
      return 'c' + Math.random().toString(36).slice(2, 10);
    }
  }

  // {mode:'lan', instance} from the player, or {mode:'cloud', slug, instance} from the cloud.
  var ctxPromise = fetch(ctxUrl, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('no app context (' + r.status + ')');
    return r.json();
  });

  function connect() {
    var statusListeners = [];
    var lastSeq = -1;
    var ws = null, pollTimer = null, closed = false, retry = 1000;
    var ctx = null;
    var app = {
      instance: null,
      slug: null,
      mode: null,
      clientId: clientId(),
      /** '' on the LAN (the player is this origin); null through the cloud. */
      apiBase: null,
      /** Resolves once the SDK knows where it is; every call below waits for it. */
      ready: null,
      send: function (data) {
        return app.ready.then(function () {
          return fetch(app._appBase + '/events', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client: app.clientId, data: data })
          });
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || r.status); }, function () { throw new Error(String(r.status)); });
          return r.json();
        });
      },
      status: function () {
        return app.ready.then(function () {
          return fetch(app._appBase + '/status', { cache: 'no-store' });
        }).then(function (r) { return r.ok ? r.json() : null; });
      },
      onStatus: function (cb) {
        statusListeners.push(cb);
        app.ready.then(ensureFeed);
        return function () { statusListeners = statusListeners.filter(function (f) { return f !== cb; }); };
      },
      get: function (scope, key) {
        return app.ready.then(function () {
          return fetch(app._appBase + '/data/' + scope + '/' + encodeURIComponent(key), { cache: 'no-store' });
        }).then(function (r) {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(String(r.status));
          var t = r.headers.get('content-type') || '';
          return t.indexOf('json') !== -1 ? r.json() : r.text();
        });
      },
      put: function (scope, key, value, contentType) {
        var body = value, type = contentType;
        if (!(value instanceof Blob) && !(value instanceof ArrayBuffer) && typeof value !== 'string') {
          body = JSON.stringify(value); type = type || 'application/json';
        }
        return app.ready.then(function () {
          return fetch(app._appBase + '/data/' + scope + '/' + encodeURIComponent(key), {
            method: 'PUT', headers: { 'content-type': type || 'application/octet-stream' }, body: body
          });
        }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
      },
      remove: function (scope, key) {
        return app.ready.then(function () {
          return fetch(app._appBase + '/data/' + scope + '/' + encodeURIComponent(key), { method: 'DELETE' });
        }).then(function (r) { return r.ok; });
      },
      close: function () { closed = true; if (ws) ws.close(); if (pollTimer) clearTimeout(pollTimer); }
    };

    app.ready = ctxPromise.then(function (c) {
      ctx = c;
      app.mode = c.mode;
      app.instance = c.instance;
      app.slug = c.slug || null;
      var inst = encodeURIComponent(c.instance || '');
      if (c.mode === 'cloud') {
        // Visitors reach the player through the show's slug routes, same origin as this page.
        app._appBase = '/api/show/' + encodeURIComponent(c.slug) + '/apps/' + inst;
        app.apiBase = null;
      } else {
        app._appBase = '/api/ezp/apps/' + inst;
        app.apiBase = '';
      }
      return app;
    });

    function deliver(snap) {
      if (!snap || typeof snap.seq !== 'number' || snap.seq === lastSeq) return;
      lastSeq = snap.seq;
      statusListeners.forEach(function (cb) { try { cb(snap.state, snap); } catch (e) { console.error(e); } });
    }
    function poll() {
      if (closed) return;
      app.status().then(deliver, function () {}).then(function () {
        pollTimer = setTimeout(poll, ws ? 15000 : 2000);
      });
    }
    function ensureFeed() {
      if (ws || closed || !ctx) return;
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      try {
        ws = new WebSocket(proto + location.host + app._appBase + '/live');
      } catch (e) { ws = null; poll(); return; }
      ws.onmessage = function (ev) {
        try { var msg = JSON.parse(ev.data); if (msg.type === 'status') deliver(msg); } catch (e) {}
      };
      ws.onopen = function () { retry = 1000; };
      ws.onclose = function () {
        ws = null;
        if (closed) return;
        setTimeout(ensureFeed, retry);
        retry = Math.min(retry * 2, 30000);
      };
      ws.onerror = function () { if (ws) ws.close(); };
      if (!pollTimer) poll(); // the first snapshot, and a safety net while the socket is down
    }
    return app;
  }

  window.EZApp = { connect: connect, ready: ctxPromise };
})();
`;
