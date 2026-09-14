/*
 * The /matrix page: a self-contained viewer that polls one model's canonical
 * pixels and paints them full-screen. Serves the Electron virtual-matrix
 * windows and any browser pointed at the player.
 *
 * Query: model=NAME  fps=30  smooth=0|1  fit=contain|fill  bg=000000
 */

export const MATRIX_PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EZPlayer matrix</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
  canvas { display: block; width: 100vw; height: 100vh; }
  #msg { position: fixed; left: 0; right: 0; bottom: 8px; text-align: center; color: #888;
         font: 14px system-ui, sans-serif; opacity: 0; transition: opacity .3s; pointer-events: none; }
  #msg.show { opacity: 1; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="msg"></div>
<script>
(() => {
  const q = new URLSearchParams(location.search);
  const model = q.get('model') || '';
  const fps = Math.max(1, Math.min(120, Number(q.get('fps')) || 30));
  const smooth = q.get('smooth') === '1';
  const fit = q.get('fit') === 'fill' ? 'fill' : 'contain';
  const bg = '#' + (q.get('bg') || '000000').replace(/[^0-9a-fA-F]/g, '').padEnd(6, '0');
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });
  const msg = document.getElementById('msg');
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  let img = null, w = 0, h = 0, seq = 0, lastShown = '';

  function say(t) { if (t === lastShown) return; lastShown = t; msg.textContent = t; msg.classList.toggle('show', !!t); }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    paint();
  }
  function paint() {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    ctx.imageSmoothingEnabled = smooth;
    let dw = canvas.width, dh = canvas.height, dx = 0, dy = 0;
    if (fit === 'contain') {
      const s = Math.min(canvas.width / w, canvas.height / h);
      dw = Math.round(w * s); dh = Math.round(h * s);
      dx = Math.round((canvas.width - dw) / 2); dy = Math.round((canvas.height - dh) / 2);
    }
    ctx.drawImage(off, dx, dy, dw, dh);
  }
  async function poll() {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/ezp/pool/model/' + encodeURIComponent(model) + '?after=' + seq, { cache: 'no-store' });
      if (res.status === 200) {
        const buf = new Uint8Array(await res.arrayBuffer());
        const dv = new DataView(buf.buffer);
        const nw = dv.getUint16(0, true), nh = dv.getUint16(2, true);
        seq = dv.getUint32(4, true);
        const stride = dv.getUint8(8);
        const bottomFirst = (dv.getUint8(9) & 1) === 1;
        if (nw !== w || nh !== h || !img) {
          w = nw; h = nh; off.width = w; off.height = h; img = octx.createImageData(w, h);
        }
        const px = img.data;
        for (let y = 0; y < h; ++y) {
          const srow = bottomFirst ? (h - 1 - y) : y;
          let s = 12 + srow * w * stride;
          let d = y * w * 4;
          for (let x = 0; x < w; ++x, s += stride, d += 4) {
            px[d] = buf[s]; px[d + 1] = buf[s + 1]; px[d + 2] = buf[s + 2]; px[d + 3] = 255;
          }
        }
        octx.putImageData(img, 0, 0);
        paint();
        say('');
      } else if (res.status === 404) {
        say(model ? 'No pixel model named "' + model + '"' : 'Add ?model=NAME to the URL');
      } else if (res.status === 204 && !img) {
        say('Waiting for frames from ' + model);
      }
    } catch (e) {
      say('Player unreachable');
    }
    const wait = Math.max(0, 1000 / fps - (performance.now() - t0));
    setTimeout(poll, wait);
  }
  addEventListener('resize', resize);
  resize();
  poll();
})();
</script>
</body>
</html>
`;
