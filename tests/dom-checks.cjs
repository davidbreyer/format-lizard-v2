const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { File } = require('node:buffer');
const root = process.cwd();
const workers = new Set();
class LocalResources extends ResourceLoader {
  fetch(url) {
    const relative = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
    const file = path.join(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return Promise.resolve(Buffer.from(''));
    let text = fs.readFileSync(file);
    if (relative === 'index.html') text = Buffer.from(text.toString().replace('<head>', '<head><script>parent.installEnvironment(window)</script>'));
    return Promise.resolve(text);
  }
}
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM(fs.readFileSync('tests/browser.html', 'utf8'), {
  url: 'http://lizard.test/tests/browser.html', runScripts: 'dangerously', resources: new LocalResources(), virtualConsole,
  beforeParse(window) {
    window.File = File;
    window.Blob = Blob;
    window.installEnvironment = (target) => {
      target.Blob = Blob; target.File = File; target.TextDecoder = TextDecoder;
      target.URL.createObjectURL = URL.createObjectURL;
      target.URL.revokeObjectURL = URL.revokeObjectURL;
      target.Worker = class {
        constructor() {
          this.worker = new Worker(path.join(root, 'tests/worker-host.cjs'));
          workers.add(this.worker);
          this.worker.on('message', data => this.onmessage?.({data}));
          this.worker.on('error', error => this.onerror?.({message:error.message,preventDefault(){}}));
        }
        postMessage(data) { this.worker.postMessage(data); }
        terminate() { workers.delete(this.worker); return this.worker.terminate(); }
      };
    };
  }
});
const timer = setInterval(() => {
  const summary = dom.window.document.querySelector('#summary').textContent;
  if (summary === 'Running…') return;
  console.log(summary.replace('browser checks', 'DOM integration checks'));
  for (const item of dom.window.document.querySelectorAll('#results li')) {
    console.log(item.textContent.replace('a real browser worker', 'a worker thread'));
  }
  if (errors.length) console.log('DOM warnings:', errors);
  clearInterval(timer);
  for (const worker of workers) worker.terminate();
  dom.window.close();
  process.exit(summary.includes('FAILED') || errors.some(e => e.includes('Uncaught')) ? 1 : 0);
}, 100);
setTimeout(() => {console.error('DOM harness timed out', errors); process.exit(1);}, 90000).unref();
