const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

function run(file, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "worker-host.cjs"));
    const progress = [];
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Worker timed out")); }, 120000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.on("error", (error) => { finish(); reject(error); });
    worker.on("message", (message) => {
      if (message.type === "progress") progress.push(message);
      if (message.type === "error") { finish(); reject(new Error(message.message)); }
      if (message.type === "complete") { finish(); resolve({ ...message, progress }); }
    });
    worker.postMessage({ file: typeof file === "string" ? new Blob([file]) : file, format: "xml", action: "format", indent: "2", sortKeys: false, ...options });
  });
}

test("formats element-only XML and minifies the result", async () => {
  const result = await run('<root><item a="&amp;">hello</item><empty/></root>');
  assert.equal(result.text, '<root>\n  <item a="&amp;">hello</item>\n  <empty />\n</root>');
  assert.equal(await result.blob.text(), result.text);
  const compact = await run(result.blob, { action: "minify" });
  assert.equal(compact.text, '<root><item a="&amp;">hello</item><empty/></root>');
  assert.equal(result.progress.at(-1).percent, 100);
});

test("preserves mixed text and all descendants, including late text", async () => {
  const input = '<root><p><b>hello</b> world <i><x/><y/></i>!</p><n><p>next</p></n></root>';
  const output = (await run(input)).text;
  assert.ok(output.includes('<p><b>hello</b> world <i><x /><y /></i>!</p>'));
  assert.ok(output.includes('\n  <n>\n    <p>next</p>\n  </n>'));
  assert.equal((await run('<p>A <b>B</b> C</p>', { action: "minify" })).text, '<p>A <b>B</b> C</p>');
});

test("preserves xml:space, CDATA, comments, PIs, namespaces, and attribute whitespace", async () => {
  const input = '<?xml version="1.0"?><r xmlns:x="urn:test"><p xml:space="preserve">  <x:b/> \n </p><!--ok--><?task go?><x:c a="one&#10;two&#9;&quot;">  <![CDATA[a<b]]> </x:c></r>';
  const output = (await run(input)).text;
  assert.ok(output.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(output.includes('<p xml:space="preserve">  <x:b /> \n </p>'));
  assert.ok(output.includes('a="one&#10;two&#9;&quot;"'));
  assert.ok(output.includes('<!--ok-->'));
  assert.ok(output.includes('<?task go?>'));
  assert.ok(output.includes('<![CDATA[a<b]]>'));
  await run(output);
});

test("preserves DOCTYPE and explicitly rejects unsupported custom entities", async () => {
  const input = '<!DOCTYPE root [<!ELEMENT root ANY>]><root/>';
  const result = await run(input);
  assert.ok(result.text.includes('<!DOCTYPE root [<!ELEMENT root ANY>]>'));
  await run(result.blob);
  await assert.rejects(run('<!DOCTYPE root [<!ENTITY name "Ada">]><root>&name;</root>'), /undefined entity/);
});

test("reports malformed XML, duplicate attributes and unbound namespace prefixes", async () => {
  for (const input of ['<r><x></r>', '<r a="1" a="2"/>', '<x:r/>', '<r>&bad;</r>', '<a/><b/>']) {
    await assert.rejects(run(input), /Invalid XML/);
  }
});

test("decodes UTF-16, legacy declared encoding and split UTF-8 characters", async () => {
  const utf16 = Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-16"?><r>café 😀</r>', 'utf16le');
  assert.ok((await run(new Blob([utf16]))).text.includes('<r>café 😀</r>'));
  assert.ok((await run('<?xml version="1.0" encoding="UTF-16"?><r>café 😀</r>', { encoding: "utf-8" })).text.includes('<r>café 😀</r>'));
  const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><r>caf\xe9</r>', 'latin1');
  assert.ok((await run(new Blob([latin]))).text.includes('<r>café</r>'));
  const split = '<r>' + 'a'.repeat(262140) + '😀é</r>';
  assert.equal((await run(split)).text, split);
  await assert.rejects(run(new Blob([Buffer.from([60, 114, 62, 0xff, 60, 47, 114, 62])])), /encoded data|encoding/i);
});

test("existing JSON, YAML and CSS engines work inside the worker", async () => {
  const json = await run('{"z":1,"a":2}', { format: "json", sortKeys: true });
  assert.equal(json.text, '{\n  "a": 2,\n  "z": 1\n}');
  const yaml = await run('a: 1\nitems:\n  - yes\n  - no', { format: "yaml" });
  assert.ok(yaml.text.includes('items:'));
  const css = await run('a{color:red;margin:0}', { format: "css" });
  assert.ok(css.text.includes('color: red;'));
  await assert.rejects(run('{"a":}', { format: "json" }), /JSON|Unexpected/);
});

test("large output is a full downloadable Blob with a bounded preview", async () => {
  const input = '<root>' + '<row a="1"><v>abc</v></row>'.repeat(100000) + '</root>';
  const result = await run(input);
  assert.equal(result.truncated, true);
  assert.equal(result.text.length, 65536);
  assert.ok(result.blob.size > input.length);
  const tail = await result.blob.slice(-100).text();
  assert.ok(tail.endsWith('</root>'));
  assert.equal(result.inputCharacters, input.length);
  const roundtrip = await run(result.blob, { action: "minify" });
  assert.equal(roundtrip.blob.size, input.length);
});

test("terminating the worker promptly cancels an active file", async () => {
  const worker = new Worker(path.join(__dirname, "worker-host.cjs"));
  const file = new Blob(['<r>', '<x>1234567890</x>'.repeat(2000000), '</r>']);
  await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", resolve);
    worker.postMessage({ file, format: "xml", action: "format", indent: "2" });
  });
  const start = performance.now();
  await worker.terminate();
  assert.ok(performance.now() - start < 2000);
});

if (process.env.LIZARD_BENCHMARK === "1") test("140 MB XML benchmark", async () => {
  const row = '<row id="123456"><name>Example</name><value>1234567890</value></row>';
  const rows = Math.ceil(140000000 / row.length);
  const file = new Blob(['<root>', row.repeat(rows), '</root>']);
  const start = performance.now();
  const result = await run(file);
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  assert.equal(result.truncated, true);
  assert.equal(result.inputCharacters, file.size);
  assert.ok((await result.blob.slice(-20).text()).endsWith('</root>'));
  console.log(JSON.stringify({ inputBytes: file.size, outputBytes: result.blob.size, seconds: elapsed, previewCharacters: result.text.length }));
});
