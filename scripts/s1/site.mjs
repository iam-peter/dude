// S1 test site: one small page per navigation pattern in src/spike/scenarios.ts.
// Serves on localhost:8765; the same server answers on 127.0.0.1:8765, which is a
// different origin and is used for the cross-origin scenario.
import http from 'node:http';

const PORT = Number(process.env.S1_PORT ?? 8765);

const page = (title, body, head = '') => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>${head}
<style>body{font:16px system-ui;margin:2rem;max-width:40rem}a{display:inline-block;margin:.2rem .6rem .2rem 0}
#section,#sec{margin-top:120vh;padding:1rem;background:#eef}</style></head>
<body><h1>${title}</h1>${body}</body></html>`;

const nav = `<p>
<a id="to-a" href="/a">to A</a><a id="to-b" href="/b">to B</a><a id="to-c" href="/c">to C</a><a id="to-d" href="/d">to D</a>
</p><p>
<a id="to-r302" href="/r302">302 → B</a><a id="to-rjs" href="/rjs">JS redirect → C</a><a id="to-rmeta" href="/rmeta">meta refresh → D</a>
</p><p>
<a id="to-frag" href="#section">#section</a><a id="to-other" href="http://127.0.0.1:${PORT}/a">other origin → A</a>
<a id="to-spa" href="/spa">SPA</a><a id="to-form" href="/form">forms</a><a id="to-newtab" href="/newtab">new tabs</a>
</p><div id="section">section</div>`;

const spa = page(
  'SPA',
  `<p id="where"></p><p>
<a id="push-p1" href="/spa/p1" data-mode="push">push /spa/p1</a>
<a id="push-p2q" href="/spa/p2?q=x" data-mode="push">push /spa/p2?q=x</a>
<a id="replace-p3" href="/spa/p3" data-mode="replace">replace /spa/p3</a>
<a id="replace-same" href="" data-mode="replace" data-same="1">replace (same URL)</a>
<a id="push-same" href="" data-mode="push" data-same="1">push (same URL)</a>
<a id="frag" href="#sec">#sec</a><a id="to-a" href="/a">to A (real navigation)</a>
</p><div id="sec">sec</div>
<script>
const show = () => { where.textContent = 'now at ' + location.pathname + location.search + location.hash; document.title = 'SPA ' + location.pathname; };
document.querySelectorAll('a[data-mode]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  history[a.dataset.mode + 'State']({}, '', a.dataset.same ? location.href : a.getAttribute('href'));
  show();
}));
addEventListener('popstate', show); show();
</script>`,
);

const routes = {
  '/': () => page('dude S1 test site', nav),
  '/a': () => page('Page A', nav),
  '/b': () => page('Page B', nav),
  '/c': () => page('Page C', nav),
  '/d': () => page('Page D', nav),
  '/rjs': () => page('JS redirect', '<p>redirecting…</p><script>setTimeout(() => location.replace("/c"), 200)</script>'),
  '/rmeta': () => page('Meta refresh', '<p>redirecting…</p>', '<meta http-equiv="refresh" content="0.5;url=/d">'),
  '/spa': () => spa,
  // S2: solid colour pages; a capture's average colour shows which page it caught.
  '/color': (url) => {
    const c = (url.searchParams.get('c') ?? 'ff0000').replace(/[^0-9a-f]/gi, '');
    return `<!doctype html><html><head><meta charset="utf-8"><title>colour ${c}</title>
<style>html,body{margin:0;height:100%;background:#${c}}a{position:fixed;top:4px;left:4px;color:#fff;font:12px system-ui}</style></head>
<body><a id="to-blue" href="/color?c=0000ff">blue</a> <a id="to-green" style="left:60px" href="/color?c=00ff00">green</a></body></html>`;
  },
  // S2: a page with realistic content for thumbnail sizes (text, boxes, a noise region as the worst case).
  '/busy': () =>
    page(
      'Busy page',
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${Array.from({ length: 9 }, (_, i) => `<div style="height:70px;border-radius:8px;background:hsl(${i * 40} 70% 60%)"></div>`).join('')}</div>
${Array.from({ length: 6 }, (_, i) => `<h2>Section ${i + 1}</h2><p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(3)}</p>`).join('')}
<canvas id="noise" width="400" height="220" style="position:fixed;right:10px;top:80px"></canvas>
<script>const c=document.getElementById('noise').getContext('2d');const d=c.createImageData(400,220);for(let i=0;i<d.data.length;i++)d.data[i]=i%4===3?255:Math.random()*255;c.putImageData(d,0,0)</script>`,
    ),
  '/s1-control': () => page('S1 control', '<p>Automation control tab — the dude content script relays messages from here.</p>'),
  '/form': () =>
    page(
      'Forms',
      `<form method="post" action="/post-result"><input name="note" value="hello"><button id="post-submit">POST</button></form>
<form method="get" action="/search"><input name="q" value="dude"><button id="get-submit">GET</button></form>`,
    ),
  '/search': (url) => page(`Search: ${url.searchParams.get('q')}`, nav),
  '/newtab': () =>
    page(
      'New tabs',
      `<p><a id="blank" href="/b" target="_blank" rel="opener">_blank → B</a>
<a id="blank-noopener" href="/c" target="_blank" rel="noopener">_blank noopener → C</a>
<a id="winopen" href="/d" onclick="event.preventDefault(); window.open('/d')">window.open → D</a></p>${nav}`,
    ),
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const log = (status) => console.log(new Date().toISOString(), req.method, url.host + url.pathname + url.search, status);

    if (url.pathname === '/r302') {
      res.writeHead(302, { Location: '/b' }).end();
      return log(302);
    }
    if (url.pathname === '/post-result' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('POST result', `<p>received: ${body.replace(/[<&]/g, '')}</p>${nav}`));
        log(200);
      });
      return;
    }
    const route = routes[url.pathname] ?? (url.pathname.startsWith('/spa/') ? routes['/spa'] : null);
    if (!route) {
      res.writeHead(404).end('not found');
      return log(404);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(route(url));
    log(200);
  })
  .listen(PORT, () => console.log(`S1 test site on http://localhost:${PORT} (other origin: http://127.0.0.1:${PORT})`));
