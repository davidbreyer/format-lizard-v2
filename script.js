const sourceInput = document.querySelector("#sourceInput");
const formattedOutput = document.querySelector("#formattedOutput");
const formatSelect = document.querySelector("#format");
const indentSelect = document.querySelector("#indent");
const sortKeys = document.querySelector("#sortKeys");
const openButton = document.querySelector("#openButton");
const fileInput = document.querySelector("#fileInput");
const formatButton = document.querySelector("#formatButton");
const minifyButton = document.querySelector("#minifyButton");
const unescapeButton = document.querySelector("#unescapeButton");
const jsonToXmlButton = document.querySelector("#jsonToXmlButton");
const copyButton = document.querySelector("#copyButton");
const saveButton = document.querySelector("#saveButton");
const clearButton = document.querySelector("#clearButton");
const status = document.querySelector("#status");
const stats = document.querySelector("#stats");
const inputCount = document.querySelector("#inputCount");
const outputCount = document.querySelector("#outputCount");
const textViewButton = document.querySelector("#textViewButton");
const treeViewButton = document.querySelector("#treeViewButton");
const treeActions = document.querySelector("#treeActions");
const expandTreeButton = document.querySelector("#expandTreeButton");
const collapseTreeButton = document.querySelector("#collapseTreeButton");
const treeOutput = document.querySelector("#treeOutput");
const releaseStamp = document.querySelector("#releaseStamp");
const workspaceStatus = document.querySelector("#workspaceStatus");

const appRelease = "20261118-0943";

const workspaceStorageKey = "format-lizard.workspace.v2";
let workspaceSaveTimer = null;

const formatSamples = {
  json: JSON.stringify({
    project: "Format Lizard",
    format: "json",
    active: true,
    checks: ["parse", "format", "copy"],
    nested: {
      indent: 2,
      futureFormats: ["xml", "yaml", "toml"]
    }
  }),
  xml: '<project name="Format Lizard"><format>xml</format><checks><check>parse</check><check>format</check><check>copy</check></checks></project>',
  yaml: 'project: Format Lizard\nformat: yaml\nactive: true\nchecks:\n  - parse\n  - format\n  - copy\nnested:\n  indent: 2\n  futureFormats:\n    - json\n    - xml\n    - toml',
  css: '/* Format Lizard buttons */\n.button{color:white;background:#5f7a38;border-radius:8px}.button:hover{background:#35471e}@media (max-width: 640px){.button{width:100%}}'
};

const formatLabels = {
  json: "JSON",
  xml: "XML",
  yaml: "YAML",
  css: "CSS"
};

const fileExtensions = {
  json: "json",
  xml: "xml",
  yaml: "yaml",
  css: "css"
};

const mimeTypes = {
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  css: "text/css"
};

const placeholders = {
  json: '{"name":"Ada","tools":["logic","tea"],"ready":true}',
  xml: '<project name="Ada"><tool>logic</tool><ready>true</ready></project>',
  yaml: 'name: Ada\ntools:\n  - logic\n  - tea\nready: true',
  css: '.button{color:white;background:#5f7a38}'
};

const formatters = {
  json: {
    format: formatJson,
    minify: minifyJson
  },
  xml: {}, // XML is processed by formatter-worker.js.
  yaml: {
    format: formatYaml,
    minify: minifyYaml
  },
  css: {
    format: formatCss,
    minify: minifyCss
  }
};

renderReleaseStamp();
if (!restoreWorkspace()) {
  sourceInput.value = formatSamples.json;
  updateFormatControls();
  formatInput();
}

openButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", openSelectedFile);
onWorkspaceAction(formatButton, "click", formatInput);
onWorkspaceAction(minifyButton, "click", minifyInput);
onWorkspaceAction(unescapeButton, "click", unescapeJsonString);
onWorkspaceAction(jsonToXmlButton, "click", convertJsonToXml);
copyButton.addEventListener("click", copyOutput);
saveButton.addEventListener("click", saveOutput);
onWorkspaceAction(clearButton, "click", clearEditors);
onWorkspaceAction(textViewButton, "click", () => setOutputView("text"));
onWorkspaceAction(treeViewButton, "click", () => setOutputView("tree"));
expandTreeButton.addEventListener("click", () => setTreeExpanded(true));
collapseTreeButton.addEventListener("click", () => setTreeExpanded(false));
sourceInput.addEventListener("input", (event) => {
  handleInputChange(event);
  clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = setTimeout(saveWorkspace, 250);
});
onWorkspaceAction(formatSelect, "change", handleFormatChange);
onWorkspaceAction(indentSelect, "change", () => {
  if (formattedOutput.value.trim()) {
    formatInput();
  }
});
onWorkspaceAction(sortKeys, "change", () => {
  if (formatSelect.value === "json" && formattedOutput.value.trim()) {
    formatInput();
  }
});
window.addEventListener("pagehide", flushWorkspaceSave);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushWorkspaceSave();
});

function onWorkspaceAction(control, event, action) {
  control.addEventListener(event, async () => {
    await action();
    saveWorkspace();
  });
}

function restoreWorkspace() {
  let workspace;
  try {
    const raw = localStorage.getItem(workspaceStorageKey);
    if (raw === null) return false;
    if (raw.length > WORKSPACE_CHAR_LIMIT * 2) throw new Error("Saved workspace is too large");
    workspace = JSON.parse(raw);
    if (typeof workspace?.input !== "string" || typeof workspace.output !== "string") {
      throw new Error("Invalid workspace");
    }
  } catch {
    setWorkspaceStatus("Could not restore the saved workspace.");
    return false;
  }

  if (typeof workspace.format === "string" && Object.hasOwn(formatters, workspace.format)) {
    formatSelect.value = workspace.format;
  }
  if (Array.from(indentSelect.options).some((option) => option.value === workspace.indent)) {
    indentSelect.value = workspace.indent;
  }
  sortKeys.checked = workspace.sortKeys === true;
  sourceInput.value = workspace.input;
  formattedOutput.value = workspace.output;
  if (workspace.output && typeof workspace.outputFormat === "string" && Object.hasOwn(formatters, workspace.outputFormat)) {
    formattedOutput.dataset.outputFormat = workspace.outputFormat;
  }
  updateFormatControls();
  updateTreeOutput();
  setOutputView(workspace.view);
  updateCounts();
  setStatus(workspace.input || workspace.output ? "Workspace restored" : "Ready", "idle");
  setWorkspaceStatus("Workspace saved in this browser.");
  return true;
}

function saveWorkspace() {
  if (processing) return;
  if (largeSourceFile || outputIsPreview || sourceInput.value.length + formattedOutput.value.length > WORKSPACE_CHAR_LIMIT) {
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = null;
    try { localStorage.removeItem(workspaceStorageKey); } catch { /* Storage may be unavailable. */ }
    setWorkspaceStatus("Large workspace stays in this tab only. Save output before closing.");
    return;
  }
  clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = null;
  const workspace = {
    format: formatSelect.value,
    indent: indentSelect.value,
    sortKeys: sortKeys.checked,
    view: treeViewButton.getAttribute("aria-pressed") === "true" ? "tree" : "text",
    input: sourceInput.value,
    output: formattedOutput.value,
    outputFormat: formattedOutput.dataset.outputFormat ?? null
  };
  try {
    localStorage.setItem(workspaceStorageKey, JSON.stringify(workspace));
    setWorkspaceStatus("Workspace saved in this browser.");
  } catch {
    setWorkspaceStatus("Workspace changes could not be saved.");
  }
}

function flushWorkspaceSave() {
  if (workspaceSaveTimer !== null) saveWorkspace();
}

function setWorkspaceStatus(message) {
  if (workspaceStatus.textContent !== message) workspaceStatus.textContent = message;
}

function formatInput() {
  if (formatSelect.value === "xml" || largeSourceFile || sourceInput.value.length > LARGE_FILE_BYTES) {
    return processInBackground("format");
  }
  resetWorkerOutput();
  fullInputCharacters = null;
  const input = sourceInput.value.trim();
  if (!input) {
    formattedOutput.value = "";
    delete formattedOutput.dataset.outputFormat;
    clearTreeOutput();
    setStatus("Ready", "idle");
    updateCounts();
    return;
  }

  const selectedFormatter = formatters[formatSelect.value];
  if (!selectedFormatter) {
    setStatus("That format is not available right now.", "error");
    return;
  }

  try {
    formattedOutput.value = selectedFormatter.format(input);
    formattedOutput.dataset.outputFormat = formatSelect.value;
    updateTreeOutput();
    setStatus(`Formatted ${getFormatLabel()}`, "valid");
  } catch (error) {
    formattedOutput.value = "";
    delete formattedOutput.dataset.outputFormat;
    clearTreeOutput();
    setStatus(error.message, "error");
  }

  updateCounts();
}

async function openSelectedFile() {
  const [file] = fileInput.files;
  fileInput.value = "";
  if (file) await openFileInV2(file);
}

function applyDetectedOrNamedFormat(content, fileName) {
  const detectedFormat = detectFormat(content) || detectFormatFromFileName(fileName);
  if (!detectedFormat || detectedFormat === formatSelect.value) {
    return;
  }

  formatSelect.value = detectedFormat;
  updateFormatControls();
}

function minifyInput() {
  if (formatSelect.value === "xml" || largeSourceFile || sourceInput.value.length > LARGE_FILE_BYTES) {
    return processInBackground("minify");
  }
  resetWorkerOutput();
  fullInputCharacters = null;
  const input = sourceInput.value.trim();
  if (!input) {
    formattedOutput.value = "";
    delete formattedOutput.dataset.outputFormat;
    clearTreeOutput();
    setStatus("Ready", "idle");
    updateCounts();
    return;
  }

  const selectedFormatter = formatters[formatSelect.value];
  if (!selectedFormatter) {
    setStatus("That format is not available right now.", "error");
    return;
  }

  try {
    formattedOutput.value = selectedFormatter.minify(input);
    formattedOutput.dataset.outputFormat = formatSelect.value;
    updateTreeOutput();
    setStatus(`Minified ${getFormatLabel()}`, "valid");
  } catch (error) {
    formattedOutput.value = "";
    delete formattedOutput.dataset.outputFormat;
    clearTreeOutput();
    setStatus(error.message, "error");
  }

  updateCounts();
}

function handleFormatChange() {
  const selectedFormat = formatSelect.value;
  updateFormatControls();

  if (!sourceInput.value.trim() || formattedOutput.value.trim()) {
    sourceInput.value = formatSamples[selectedFormat] || "";
    formattedOutput.value = "";
    delete formattedOutput.dataset.outputFormat;
    clearTreeOutput();
    formatInput();
  } else {
    updateCounts();
  }
}

function handleInputChange(event) {
  fullInputCharacters = null;
  resetWorkerOutput();
  if (sourceInput.value.length > LARGE_FILE_BYTES) {
    if (looksLikeXml(sourceInput.value.slice(0, 4096).trimStart())) {
      formatSelect.value = "xml";
      updateFormatControls();
    }
    setStatus("Large input ready. Choose Format or Minify to process in the background.", "idle");
    updateCounts();
    return;
  }
  autoDetectFormat(sourceInput.value);
  if (event.inputType === "insertFromPaste" && formatSelect.value === "json") {
    formatInput();
    return;
  }
  updateCounts();
}

function autoDetectFormat(value) {
  const detectedFormat = detectFormat(value);
  if (!detectedFormat || detectedFormat === formatSelect.value) {
    return;
  }

  formatSelect.value = detectedFormat;
  formattedOutput.value = "";
  delete formattedOutput.dataset.outputFormat;
  clearTreeOutput();
  updateFormatControls();
  setStatus(`Detected ${getFormatLabel()}`, "valid");
}

function detectFormat(value) {
  const input = value.trim();
  if (!input) {
    return null;
  }

  if (looksLikeJson(input)) {
    return "json";
  }

  if (looksLikeXml(input)) {
    return "xml";
  }

  if (looksLikeCss(input)) {
    return "css";
  }

  if (looksLikeYaml(input)) {
    return "yaml";
  }

  return null;
}

function detectFormatFromFileName(fileName) {
  const extension = fileName.split(".").pop().toLowerCase();
  if (extension === "json") {
    return "json";
  }

  if (extension === "xml" || extension === "config") {
    return "xml";
  }

  if (extension === "yaml" || extension === "yml") {
    return "yaml";
  }

  if (extension === "css") {
    return "css";
  }

  return null;
}

function looksLikeJson(input) {
  const first = input[0];
  const last = input[input.length - 1];
  return (first === "{" && last === "}") || (first === "[" && last === "]");
}

function looksLikeXml(input) {
  return /^<\?xml[\s>]/i.test(input) || /^<[A-Za-z_][\w:.-]*(\s|>|\/>)/.test(input);
}

function looksLikeCss(input) {
  if (!/[{}]/.test(input) || !/[.#@:[\]\w-][^{]*\{[^}]*[:;]/.test(input)) {
    return false;
  }

  try {
    validateCssTokens(tokenizeCss(input));
    return true;
  } catch {
    return false;
  }
}

function looksLikeYaml(input) {
  try {
    parseYaml(input);
    return /^[A-Za-z_"][^{}[\]]*:\s*/m.test(input) || /^\s*-\s+\S/m.test(input);
  } catch {
    return false;
  }
}

function updateFormatControls() {
  formatSelect.disabled = Boolean(largeSourceFile);
  sourceInput.placeholder = placeholders[formatSelect.value] || "";
  formattedOutput.placeholder = `Formatted ${getFormatLabel()} will appear here`;
  const isJson = formatSelect.value === "json";
  sortKeys.disabled = !isJson;
  unescapeButton.disabled = !isJson;
  jsonToXmlButton.disabled = !isJson;
}

function unescapeJsonString() {
  resetWorkerOutput();
  if (formatSelect.value !== "json") {
    setStatus("Unescape is only available for JSON.", "error");
    return;
  }

  const input = sourceInput.value.trim();
  if (!input) {
    setStatus("Nothing to unescape", "error");
    return;
  }

  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== "string") {
      setStatus("Input is valid JSON, but not a JSON string.", "error");
      return;
    }

    sourceInput.value = parsed;
    formattedOutput.value = "";
    delete formattedOutput.dataset.outputFormat;
    clearTreeOutput();
    autoDetectFormat(parsed);
    formatInput();
    setStatus("Unescaped JSON string", "valid");
  } catch (error) {
    setStatus(getJsonErrorMessage(error), "error");
  }
}

function convertJsonToXml() {
  resetWorkerOutput();
  if (formatSelect.value !== "json") {
    setStatus("JSON to XML is only available for JSON input.", "error");
    return;
  }

  const input = sourceInput.value.trim();
  if (!input) {
    setStatus("Nothing to convert", "error");
    return;
  }

  try {
    const parsed = prepareJsonValue(JSON.parse(input));
    formattedOutput.value = jsonValueToXmlDocument(parsed);
    formattedOutput.dataset.outputFormat = "xml";
    clearTreeOutput();
    setStatus("Converted JSON to XML", "valid");
  } catch (error) {
    formattedOutput.value = "";
    delete formattedOutput.dataset.outputFormat;
    clearTreeOutput();
    setStatus(getJsonErrorMessage(error), "error");
  }

  updateCounts();
}

async function copyOutput() {
  if (outputIsPreview) {
    setStatus("Use Save to download the complete output.", "idle");
    return;
  }
  if (!formattedOutput.value) {
    setStatus("Nothing to copy", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(formattedOutput.value);
    setStatus("Copied output", "valid");
  } catch {
    formattedOutput.select();
    document.execCommand("copy");
    setStatus("Copied output", "valid");
  }
}

function saveOutput() {
  if (!fullOutputBlob && !formattedOutput.value) {
    setStatus("Nothing to save", "error");
    return;
  }

  const outputFormat = getOutputFormat();
  const blob = fullOutputBlob || new Blob([formattedOutput.value], {
    type: `${mimeTypes[outputFormat] || "text/plain"};charset=utf-8`
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `format-lizard-${appRelease}.${fileExtensions[outputFormat] || "txt"}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
  setStatus("Saved output file", "valid");
}

function clearEditors() {
  cancelProcessing(false);
  largeSourceFile = null;
  largeSourceEncoding = null;
  fullInputCharacters = null;
  resetWorkerOutput();
  sourceInput.readOnly = false;
  updateFormatControls();
  sourceInput.value = "";
  formattedOutput.value = "";
  delete formattedOutput.dataset.outputFormat;
  clearTreeOutput();
  setStatus("Ready", "idle");
  updateCounts();
  sourceInput.focus();
}

function updateCounts() {
  const inputLength = fullInputCharacters ?? sourceInput.value.length;
  const outputLength = fullOutputCharacters ?? formattedOutput.value.length;
  inputCount.textContent = largeSourceFile && fullInputCharacters === null ? `${formatBytes(largeSourceFile.size)} file` : formatCount(inputLength);
  outputCount.textContent = `${formatCount(outputLength)}${outputIsPreview ? " (preview)" : ""}`;
  stats.textContent = `${formatCount(inputLength)} input / ${formatCount(outputLength)} output`;
}

function setStatus(message, type) {
  status.textContent = message;
  status.className = `status-pill status-${type}`;
}

function setOutputView(view) {
  const showTree = view === "tree" && !treeViewButton.disabled;
  formattedOutput.classList.toggle("hidden", showTree);
  treeOutput.classList.toggle("hidden", !showTree);
  setTreeActionsVisible(showTree);
  textViewButton.classList.toggle("active", !showTree);
  treeViewButton.classList.toggle("active", showTree);
  textViewButton.setAttribute("aria-pressed", String(!showTree));
  treeViewButton.setAttribute("aria-pressed", String(showTree));
}

function updateTreeOutput() {
  if (getOutputFormat() !== "json" || outputIsPreview || formattedOutput.value.length > 100000 || !formattedOutput.value.trim()) {
    clearTreeOutput();
    return;
  }

  try {
    const parsed = JSON.parse(formattedOutput.value);
    treeOutput.replaceChildren(renderJsonTree(parsed, "$"));
    treeViewButton.disabled = false;
  } catch {
    clearTreeOutput();
  }
}

function clearTreeOutput() {
  treeOutput.replaceChildren();
  treeViewButton.disabled = true;
  setOutputView("text");
}

function setTreeActionsVisible(isVisible) {
  treeActions.classList.toggle("is-hidden", !isVisible);
  treeActions.setAttribute("aria-hidden", String(!isVisible));
  expandTreeButton.disabled = !isVisible;
  collapseTreeButton.disabled = !isVisible;
}

function setTreeExpanded(isExpanded) {
  treeOutput.querySelectorAll("details").forEach((details) => {
    details.open = isExpanded;
  });
}

function renderJsonTree(value, label) {
  const node = document.createElement("div");
  node.className = "tree-node";

  if (isJsonContainer(value)) {
    const details = document.createElement("details");
    details.open = true;

    const summary = document.createElement("summary");
    summary.append(renderJsonContainerLine(value, label));
    details.append(summary);

    const children = document.createElement("div");
    children.className = "tree-children";
    const entries = Array.isArray(value)
      ? value.map((item, index) => [index, item])
      : Object.entries(value);

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = Array.isArray(value) ? "empty array" : "empty object";
      children.append(empty);
    } else {
      entries.forEach(([key, childValue]) => {
        children.append(renderJsonTree(childValue, key));
      });
    }

    details.append(children);
    node.append(details);
    return node;
  }

  node.append(renderJsonLeafLine(value, label));
  return node;
}

function renderJsonContainerLine(value, label) {
  const line = document.createElement("span");
  line.className = "tree-line";
  line.append(renderJsonLabel(label));

  const meta = document.createElement("span");
  meta.className = "tree-meta";
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  meta.textContent = Array.isArray(value)
    ? `[${count} ${count === 1 ? "item" : "items"}]`
    : `{${count} ${count === 1 ? "key" : "keys"}}`;
  line.append(meta);
  return line;
}

function renderJsonLeafLine(value, label) {
  const line = document.createElement("div");
  line.className = "tree-line";
  line.append(renderJsonLabel(label));

  const valueNode = document.createElement("span");
  valueNode.className = `tree-${getJsonType(value)}`;
  valueNode.textContent = formatJsonLeafValue(value);
  line.append(valueNode);
  return line;
}

function renderJsonLabel(label) {
  const labelNode = document.createElement("span");
  labelNode.className = Number.isInteger(Number(label)) && String(Number(label)) === String(label)
    ? "tree-index"
    : "tree-key";
  labelNode.textContent = `${label}:`;
  return labelNode;
}

function isJsonContainer(value) {
  return value !== null && typeof value === "object";
}

function getJsonType(value) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function formatJsonLeafValue(value) {
  if (typeof value === "string") {
    return `"${value}"`;
  }

  if (value === null) {
    return "null";
  }

  return String(value);
}

function getOutputFormat() {
  return formattedOutput.dataset.outputFormat || formatSelect.value;
}

function getXmlErrorMessage(parserError) {
  const text = parserError.textContent.replace(/\s+/g, " ").trim();
  const match = text.match(/line\s+(\d+).*column\s+(\d+)/i);
  if (match) {
    return `Invalid XML at line ${match[1]}, column ${match[2]}`;
  }
  return "Invalid XML";
}

function getFormatLabel() {
  return formatLabels[formatSelect.value] || formatSelect.value.toUpperCase();
}

function formatCount(value) {
  return `${value.toLocaleString()} ${value === 1 ? "char" : "chars"}`;
}

function renderReleaseStamp() {
  if (releaseStamp) {
    releaseStamp.textContent = `Version: ${appRelease}`;
  }
}
