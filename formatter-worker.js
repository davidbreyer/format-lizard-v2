/* Files stay in this browser. Terminating this worker cancels all processing. */
const workerRelease = self.location ? new URL(self.location.href).searchParams.get("v") : null;
const workerCacheSuffix = workerRelease ? `?v=${encodeURIComponent(workerRelease)}` : "";
importScripts(`vendor/saxes.js${workerCacheSuffix}`, `format-core.js${workerCacheSuffix}`);

const indentSelect = { value: "2" };
const sortKeys = { checked: false };
const sourceInput = { value: "" };
const CHUNK_BYTES = 256 * 1024;
const PREVIEW_CHARS = 64 * 1024;
const EDITOR_CHARS = 2 * 1024 * 1024;

self.onmessage = async ({ data }) => {
  try {
    indentSelect.value = data.indent;
    sortKeys.checked = data.sortKeys;
    if (!(data.file instanceof Blob)) throw new Error("Choose a file or enter some text first.");
    const result = data.format === "xml"
      ? await processXml(data.file, data.action, data.encoding)
      : await processOther(data.file, data.format, data.action);
    self.postMessage({ type: "complete", ...result });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "Could not process this file." });
  }
};

async function fileEncoding(file) {
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if ((header[0] === 0xff && header[1] === 0xfe) || (header[0] === 0x3c && header[1] === 0)) return "utf-16le";
  if ((header[0] === 0xfe && header[1] === 0xff) || (header[0] === 0 && header[1] === 0x3c)) return "utf-16be";
  const declaration = new TextDecoder().decode(header).match(/^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i);
  const encoding = declaration?.[1] || "utf-8";
  // TextDecoder reports unsupported encoding names; fatal decoding rejects damaged input.
  new TextDecoder(encoding, { fatal: true });
  return encoding;
}

async function feedXml(file, encoding, parser, phase) {
  const decoder = new TextDecoder(encoding, { fatal: true });
  let characters = 0;
  let lastProgress = 0;
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, file.size);
    const text = decoder.decode(await file.slice(offset, end).arrayBuffer(), { stream: true });
    characters += text.length;
    parser.write(text);
    const now = performance.now();
    if (now - lastProgress > 100 || end === file.size) {
      self.postMessage({ type: "progress", phase, percent: Math.round((phase === "Checking XML" ? end / file.size : 1 + end / file.size) * 50) });
      lastProgress = now;
    }
  }
  const tail = decoder.decode();
  characters += tail.length;
  parser.write(tail).close();
  return characters;
}

function xmlParser() {
  const parser = new XmlSaxes.SaxesParser({ xmlns: true });
  parser.on("error", (error) => { throw new Error(`Invalid XML: ${error.message}`); });
  return parser;
}

function xmlText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u0084\u0086-\u009f]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function xmlAttribute(text) {
  return xmlText(text).replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;");
}

function outputWriter(type) {
  const parts = [];
  let buffer = [];
  let bufferedCharacters = 0;
  let characters = 0;
  let preview = "";
  const flush = () => {
    if (buffer.length) parts.push(new Blob([buffer.join("")], { type }));
    buffer = [];
    bufferedCharacters = 0;
  };
  return {
    append(text) {
      if (preview.length < PREVIEW_CHARS) preview += text.slice(0, PREVIEW_CHARS - preview.length);
      characters += text.length;
      buffer.push(text);
      bufferedCharacters += text.length;
      if (bufferedCharacters >= CHUNK_BYTES) flush();
    },
    async finish() {
      flush();
      const blob = new Blob(parts, { type });
      const truncated = characters > EDITOR_CHARS;
      return { blob, outputCharacters: characters, truncated, text: truncated ? preview : await blob.text() };
    }
  };
}

async function processXml(file, action, encodingOverride) {
  const encoding = encodingOverride || await fileEncoding(file);
  // A first pass identifies mixed content before any whitespace is changed.
  // Only mixed element IDs and the current ancestor stack are retained, never a DOM.
  const mixed = new Set();
  let stack = [];
  let id = 0;
  const analysis = xmlParser();
  analysis.on("opentag", () => {
    if (stack.length) stack[stack.length - 1].markup = true;
    stack.push({ id: id++, text: false, markup: false });
  });
  analysis.on("text", (text) => {
    if (stack.length && /\S/.test(text)) stack[stack.length - 1].text = true;
  });
  analysis.on("cdata", () => { if (stack.length) stack[stack.length - 1].text = true; });
  for (const event of ["comment", "processinginstruction"]) {
    analysis.on(event, () => { if (stack.length) stack[stack.length - 1].markup = true; });
  }
  analysis.on("closetag", () => {
    const item = stack.pop();
    if (item.text && item.markup) mixed.add(item.id);
  });
  const inputCharacters = await feedXml(file, encoding, analysis, "Checking XML");
  const writer = outputWriter("application/xml;charset=utf-8");
  const parser = xmlParser();
  const pretty = action !== "minify";
  const indent = getIndentString();
  stack = [];
  id = 0;
  let hasOutput = false;
  const beforeMarkup = () => {
    const parent = stack[stack.length - 1];
    if (pretty && !parent?.preserve && hasOutput) writer.append("\n" + indent.repeat(stack.length));
    if (parent) parent.markup = true;
    hasOutput = true;
  };
  parser.on("xmldecl", (declaration) => {
    let value = `<?xml version="${declaration.version}" encoding="UTF-8"`;
    if (declaration.standalone) value += ` standalone="${declaration.standalone}"`;
    writer.append(value + "?>");
    hasOutput = true;
  });
  parser.on("doctype", (doctype) => {
    beforeMarkup();
    writer.append(`<!DOCTYPE${doctype}>`);
  });
  parser.on("opentag", (tag) => {
    const parent = stack[stack.length - 1];
    beforeMarkup();
    const attributes = Object.values(tag.attributes).map((attribute) => ` ${attribute.name}="${xmlAttribute(attribute.value)}"`).join("");
    writer.append(`<${tag.name}${attributes}${tag.isSelfClosing ? (pretty ? " />" : "/>") : ">"}`);
    const space = tag.attributes["xml:space"]?.value;
    const xmlSpace = space === "preserve" || (space !== "default" && parent?.xmlSpace === true);
    // Inherit mixed-content preservation even through xml:space="default" children.
    const ownMixedContent = mixed.has(id++);
    const mixedContent = Boolean(parent?.mixedContent || ownMixedContent);
    stack.push({ name: tag.name, selfClosing: tag.isSelfClosing, preserve: xmlSpace || mixedContent, xmlSpace, mixedContent, markup: false });
  });
  parser.on("text", (text) => {
    const parent = stack[stack.length - 1];
    if (parent && (parent.preserve || /\S/.test(text))) writer.append(xmlText(text));
  });
  parser.on("cdata", (text) => { writer.append(`<![CDATA[${text}]]>`); });
  parser.on("comment", (text) => { beforeMarkup(); writer.append(`<!--${text}-->`); });
  parser.on("processinginstruction", ({ target, body }) => {
    beforeMarkup();
    writer.append(`<?${target}${body ? " " + body : ""}?>`);
  });
  parser.on("closetag", () => {
    const item = stack.pop();
    if (item.selfClosing) return;
    if (pretty && item.markup && !item.preserve) writer.append("\n" + indent.repeat(stack.length));
    writer.append(`</${item.name}>`);
  });
  await feedXml(file, encoding, parser, "Writing XML");
  return { ...await writer.finish(), inputCharacters };
}

async function processOther(file, format, action) {
  self.postMessage({ type: "progress", phase: "Reading file", percent: 0 });
  const input = (await file.text()).trim();
  sourceInput.value = input;
  const processors = { json: [formatJson, minifyJson], yaml: [formatYaml, minifyYaml], css: [formatCss, minifyCss] };
  if (!processors[format]) throw new Error("Choose JSON, XML, YAML, or CSS.");
  self.postMessage({ type: "progress", phase: "Processing " + format.toUpperCase(), percent: 30 });
  const output = processors[format][action === "minify" ? 1 : 0](input);
  const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
  return { blob, text: output.length > EDITOR_CHARS ? output.slice(0, PREVIEW_CHARS) : output, truncated: output.length > EDITOR_CHARS, outputCharacters: output.length, inputCharacters: input.length };
}
