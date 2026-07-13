#!/usr/bin/env node
// Compile every *.d2 under the given directories to a sibling *.svg.
//
// Shared by the slide builder (build.mjs) and the manual (docusaurus prebuild)
// so both consume the SAME compiled diagrams from doc/assets/diagrams.
//
//   node compile-diagrams.mjs [dir ...]      (default: ../../assets)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function listD2(dir) {
    const out = [];
    const walk = (d) => {
        for (const e of readdirSync(d)) {
            const p = join(d, e);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.toLowerCase().endsWith('.d2')) out.push(p);
        }
    };
    if (existsSync(dir)) walk(dir);
    return out;
}

export async function compileDiagrams(dirs, { log = () => {} } = {}) {
    const sources = dirs.flatMap(listD2);
    if (sources.length === 0) return [];
    const { D2 } = await import('@terrastruct/d2');
    const d2 = new D2();
    const written = [];
    for (const src of sources) {
        const svg = src.replace(/\.d2$/i, '.svg');
        const compiled = await d2.compile(readFileSync(src, 'utf8'), { layout: 'dagre', pad: 20 });
        const out = await d2.render(compiled.diagram, compiled.renderOptions);
        writeFileSync(svg, out);
        written.push(svg);
        log(`  d2  ${relative(process.cwd(), src)} -> ${relative(process.cwd(), svg)}`);
    }
    return written;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
    const dirs = process.argv.slice(2).map((d) => resolve(d));
    if (dirs.length === 0) dirs.push(resolve(here, '..', '..', 'assets'));
    compileDiagrams(dirs, { log: console.log })
        .then((w) => {
            console.log(`Compiled ${w.length} diagram(s).`);
            // The d2 WASM runtime keeps the event loop alive; exit explicitly.
            process.exit(0);
        })
        .catch((e) => {
            console.error(e?.stack || String(e));
            process.exit(1);
        });
}
