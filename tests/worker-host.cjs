// Run the browser worker unchanged inside a real Node worker thread.
const { parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
globalThis.self = globalThis;
globalThis.importScripts = (...files) => {
  for (const file of files) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), { filename: file });
};
self.postMessage = (message) => parentPort.postMessage(message);
importScripts("formatter-worker.js");
parentPort.on("message", (data) => self.onmessage({ data }));
