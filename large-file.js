const LARGE_FILE_BYTES = 2 * 1024 * 1024;
const PREVIEW_BYTES = 64 * 1024;
const WORKSPACE_CHAR_LIMIT = 500 * 1024;
let largeSourceFile = null;
let largeSourceEncoding = null;
let fullOutputBlob = null;
let fullInputCharacters = null;
let fullOutputCharacters = null;
let outputIsPreview = false;
let activeWorker = null;
let finishActiveJob = null;
let jobRevision = 0;
let processing = false;
let savedControlStates = [];
const processingPanel = document.querySelector("#processingPanel");
const processingProgress = document.querySelector("#processingProgress");
const processingLabel = document.querySelector("#processingLabel");
const previewNotice = document.querySelector("#previewNotice");
const cancelButton = document.querySelector("#cancelButton");
cancelButton.addEventListener("click", () => cancelProcessing());

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function resetWorkerOutput() {
  fullOutputBlob = null;
  fullOutputCharacters = null;
  outputIsPreview = false;
  copyButton.disabled = processing;
  copyButton.removeAttribute("title");
  updatePreviewNotice();
}

function updatePreviewNotice() {
  const notes = [];
  if (largeSourceFile) notes.push(`Large file: ${largeSourceFile.name || "pasted text"} (${formatBytes(largeSourceFile.size)}). Input shows a read-only preview; the complete file is retained for Format and Minify.`);
  if (outputIsPreview) notes.push(`Output shows the first 65,536 characters. Save downloads the complete ${formatBytes(fullOutputBlob.size)} result.`);
  if (largeSourceFile || outputIsPreview) notes.push("Large files are not saved in browser storage. Open another file or Clear to return to editing.");
  previewNotice.textContent = notes.join(" ");
  previewNotice.hidden = !notes.length;
}

function setProcessing(busy) {
  if (busy === processing) return;
  processing = busy;
  processingPanel.hidden = !busy;
  if (busy) {
    savedControlStates = Array.from(document.querySelectorAll("button, select, #sortKeys"))
      .filter((control) => control !== cancelButton && control !== clearButton)
      .map((control) => [control, control.disabled]);
    for (const [control] of savedControlStates) control.disabled = true;
    processingProgress.value = 0;
    processingLabel.textContent = "Preparing file…";
  } else {
    for (const [control, disabled] of savedControlStates) control.disabled = disabled;
    savedControlStates = [];
    updateFormatControls();
    if (outputIsPreview) copyButton.disabled = true;
  }
  sourceInput.readOnly = busy || Boolean(largeSourceFile);
  sourceInput.setAttribute("aria-busy", String(busy));
}

function cancelProcessing(showStatus = true) {
  jobRevision++;
  if (activeWorker) activeWorker.terminate();
  activeWorker = null;
  if (finishActiveJob) finishActiveJob();
  finishActiveJob = null;
  const wasProcessing = processing;
  setProcessing(false);
  if (wasProcessing && showStatus) setStatus("Cancelled. Choose Format or Minify to retry.", "idle");
}

async function openFileInV2(file) {
  cancelProcessing(false);
  const revision = jobRevision;
  setProcessing(true);
  setStatus(`Opening ${file.name}…`, "idle");
  resetWorkerOutput();
  formattedOutput.value = "";
  delete formattedOutput.dataset.outputFormat;
  clearTreeOutput();
  try {
    const header = await file.slice(0, 4096).text();
    if (revision !== jobRevision) return;
    const selectedFormat = detectFormatFromFileName(file.name) || detectFormat(header) || formatSelect.value;
    formatSelect.value = selectedFormat;
    updateFormatControls();
    fullInputCharacters = null;
    let inputText;
    if (file.size > LARGE_FILE_BYTES) {
      const encoding = await previewEncoding(file);
      inputText = new TextDecoder(encoding).decode(await file.slice(0, PREVIEW_BYTES).arrayBuffer());
    } else if (selectedFormat === "xml") {
      inputText = new TextDecoder(await previewEncoding(file)).decode(await file.arrayBuffer());
    } else {
      inputText = await file.text();
    }
    if (revision !== jobRevision) return;
    largeSourceFile = file.size > LARGE_FILE_BYTES ? file : null;
    largeSourceEncoding = null;
    sourceInput.value = inputText;
    // UTF-16 XML must use the original bytes, even when it fits in the editor.
    const xmlFile = selectedFormat === "xml" ? file : null;
    setProcessing(false);
    updatePreviewNotice();
    updateCounts();
    if (selectedFormat === "xml" || largeSourceFile) await processInBackground("format", xmlFile || file);
    else formatInput();
    saveWorkspace();
  } catch (error) {
    if (revision !== jobRevision) return;
    setProcessing(false);
    setStatus(`Could not open file: ${error.message}`, "error");
  }
}

async function previewEncoding(file) {
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) return "utf-16le";
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) return "utf-16be";
  return new TextDecoder().decode(bytes).match(/^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1] || "utf-8";
}

async function processInBackground(action, fileOverride = null) {
  cancelProcessing(false);
  const revision = jobRevision;
  const encoding = fileOverride ? null : largeSourceFile ? largeSourceEncoding : "utf-8";
  const file = fileOverride || largeSourceFile || new Blob([sourceInput.value]);
  if (!file.size) {
    clearEditors();
    return;
  }
  if (!largeSourceFile && file.size > LARGE_FILE_BYTES) {
    largeSourceFile = file;
    largeSourceEncoding = encoding;
    sourceInput.value = sourceInput.value.slice(0, PREVIEW_BYTES);
    fullInputCharacters = null;
  }
  resetWorkerOutput();
  formattedOutput.value = "";
  delete formattedOutput.dataset.outputFormat;
  clearTreeOutput();
  setProcessing(true);
  updatePreviewNotice();
  setStatus(`${action === "minify" ? "Minifying" : "Formatting"} ${getFormatLabel()}…`, "idle");
  updateCounts();
  await new Promise((resolve) => {
    finishActiveJob = resolve;
    let worker;
    const finish = () => {
      worker?.terminate();
      if (revision === jobRevision) {
        activeWorker = null;
        finishActiveJob = null;
        setProcessing(false);
      }
      resolve();
    };
    const fail = (message) => {
      if (revision !== jobRevision) return;
      resetWorkerOutput();
      formattedOutput.value = "";
      delete formattedOutput.dataset.outputFormat;
      finish();
      setStatus(message, "error");
      updateCounts();
    };
    try {
      worker = new Worker(`formatter-worker.js?v=${appRelease}`);
      activeWorker = worker;
      worker.onerror = (event) => { event.preventDefault(); fail("Background processing could not start. Reload the page and try again."); };
      worker.onmessage = ({ data }) => {
        if (revision !== jobRevision) return;
        if (data.type === "progress") {
          processingProgress.value = data.percent;
          processingLabel.textContent = `${data.phase} — ${data.percent}%`;
        } else if (data.type === "error") {
          fail(data.message);
        } else if (data.type === "complete") {
          fullOutputBlob = data.blob;
          fullInputCharacters = data.inputCharacters;
          fullOutputCharacters = data.outputCharacters;
          outputIsPreview = data.truncated;
          formattedOutput.value = data.text;
          formattedOutput.dataset.outputFormat = formatSelect.value;
          finish();
          copyButton.disabled = outputIsPreview;
          if (outputIsPreview) copyButton.title = "Use Save to download the complete output.";
          updateTreeOutput();
          updatePreviewNotice();
          updateCounts();
          setStatus(`${action === "minify" ? "Minified" : "Formatted"} ${getFormatLabel()}${outputIsPreview ? " — complete result ready to save" : ""}`, "valid");
          saveWorkspace();
        }
      };
      worker.postMessage({ file, format: formatSelect.value, action, encoding, indent: indentSelect.value, sortKeys: sortKeys.checked });
    } catch (error) {
      fail(`Background processing is unavailable: ${error.message}. Open the hosted website to use workers.`);
    }
  });
}
