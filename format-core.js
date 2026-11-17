// Shared formatter functions for the background worker. No DOM access.
function formatJson(input) {
  try {
    const parsed = prepareJsonValue(JSON.parse(input));
    return JSON.stringify(parsed, null, getIndent());
  } catch (error) {
    throw new Error(getJsonErrorMessage(error));
  }
}

function minifyJson(input) {
  try {
    return JSON.stringify(prepareJsonValue(JSON.parse(input)));
  } catch (error) {
    throw new Error(getJsonErrorMessage(error));
  }
}

function prepareJsonValue(value) {
  return sortKeys.checked ? sortJsonKeys(value) : value;
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((sorted, key) => {
      sorted[key] = sortJsonKeys(value[key]);
      return sorted;
    }, {});
}

function formatYaml(input) {
  const parsed = parseYaml(input);
  return stringifyYaml(parsed, 0);
}

function minifyYaml(input) {
  const parsed = parseYaml(input);
  return stringifyYaml(parsed, 0, { compact: true });
}

function parseYaml(input) {
  const lines = normalizeYamlLines(input);
  if (!lines.length) {
    throw new Error("YAML is empty");
  }

  const [value, nextIndex] = parseYamlBlock(lines, 0, lines[0].indent);
  if (nextIndex < lines.length) {
    throw new Error(`Invalid YAML indentation at line ${lines[nextIndex].line}`);
  }

  return value;
}

function normalizeYamlLines(input) {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((rawLine, index) => {
      if (/^\t+/.test(rawLine)) {
        throw new Error(`YAML tabs are not supported at line ${index + 1}`);
      }

      const trimmedComment = stripYamlComment(rawLine);
      if (!trimmedComment.trim()) {
        return null;
      }

      return {
        indent: trimmedComment.match(/^ */)[0].length,
        text: trimmedComment.trim(),
        line: index + 1
      };
    })
    .filter(Boolean);
}

function stripYamlComment(line) {
  let quote = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = line[index - 1];

    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? null : quote || char;
    }

    if (char === "#" && !quote && (!index || /\s/.test(previous))) {
      return line.slice(0, index).trimEnd();
    }
  }

  return line.trimEnd();
}

function parseYamlBlock(lines, index, indent) {
  if (index >= lines.length) {
    return [null, index];
  }

  if (lines[index].indent < indent) {
    return [null, index];
  }

  if (lines[index].indent !== indent) {
    throw new Error(`Invalid YAML indentation at line ${lines[index].line}`);
  }

  return lines[index].text.startsWith("- ")
    ? parseYamlSequence(lines, index, indent)
    : parseYamlMapping(lines, index, indent);
}

function parseYamlMapping(lines, index, indent) {
  const result = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent) {
      throw new Error(`Invalid YAML indentation at line ${line.line}`);
    }

    if (line.text.startsWith("- ")) {
      break;
    }

    const [key, rawValue] = splitYamlKeyValue(line.text, line.line);
    cursor += 1;

    if (rawValue) {
      result[key] = parseYamlScalar(rawValue, line.line);
      continue;
    }

    if (cursor < lines.length && lines[cursor].indent > indent) {
      [result[key], cursor] = parseYamlBlock(lines, cursor, lines[cursor].indent);
    } else {
      result[key] = null;
    }
  }

  return [result, cursor];
}

function parseYamlSequence(lines, index, indent) {
  const result = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent || !line.text.startsWith("- ")) {
      break;
    }

    const itemText = line.text.slice(2).trim();
    cursor += 1;

    if (!itemText) {
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseYamlBlock(lines, cursor, lines[cursor].indent);
        result.push(parsed[0]);
        cursor = parsed[1];
      } else {
        result.push(null);
      }
      continue;
    }

    if (looksLikeYamlKeyValue(itemText)) {
      const [key, rawValue] = splitYamlKeyValue(itemText, line.line);
      const item = {};
      item[key] = rawValue ? parseYamlScalar(rawValue, line.line) : null;

      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseYamlMapping(lines, cursor, lines[cursor].indent);
        Object.assign(item, parsed[0]);
        cursor = parsed[1];
      }

      result.push(item);
      continue;
    }

    result.push(parseYamlScalar(itemText, line.line));
  }

  return [result, cursor];
}

function splitYamlKeyValue(text, lineNumber) {
  const colonIndex = findYamlSeparator(text);
  if (colonIndex < 1) {
    throw new Error(`Invalid YAML mapping at line ${lineNumber}`);
  }

  const key = text.slice(0, colonIndex).trim();
  const value = text.slice(colonIndex + 1).trim();
  if (!key) {
    throw new Error(`Invalid YAML key at line ${lineNumber}`);
  }

  return [unquoteYamlKey(key), value];
}

function findYamlSeparator(text) {
  let quote = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    const next = text[index + 1];

    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? null : quote || char;
    }

    if (char === ":" && !quote && (!next || /\s/.test(next))) {
      return index;
    }
  }

  return -1;
}

function looksLikeYamlKeyValue(text) {
  return findYamlSeparator(text) > 0;
}

function unquoteYamlKey(key) {
  if (
    (key.startsWith("\"") && key.endsWith("\"")) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    return parseYamlScalar(key, 0);
  }

  return key;
}

function parseYamlScalar(value, lineNumber) {
  if (!value) {
    return null;
  }

  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Unsupported YAML flow value at line ${lineNumber}`);
    }
  }

  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid quoted YAML string at line ${lineNumber}`);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === "true";
  }

  if (/^(null|~)$/i.test(value)) {
    return null;
  }

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) {
    return Number(value);
  }

  return value;
}

function stringifyYaml(value, level, options = {}) {
  const indentation = getIndentString();

  if (Array.isArray(value)) {
    if (!value.length) {
      return "[]";
    }

    return value
      .map((item) => {
        const prefix = `${indentation.repeat(level)}-`;
        if (isYamlScalar(item)) {
          return `${prefix} ${formatYamlScalar(item)}`;
        }

        if (isPlainYamlObject(item)) {
          return stringifyYamlSequenceObject(item, level, options);
        }

        return `${prefix}\n${stringifyYaml(item, level + 1, options)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) {
      return "{}";
    }

    return entries
      .map(([key, childValue]) => {
        const prefix = `${indentation.repeat(level)}${formatYamlKey(key)}:`;
        if (isYamlScalar(childValue)) {
          return `${prefix} ${formatYamlScalar(childValue)}`;
        }

        return `${prefix}\n${stringifyYaml(childValue, level + 1, options)}`;
      })
      .join("\n");
  }

  return `${indentation.repeat(level)}${formatYamlScalar(value)}`;
}

function stringifyYamlSequenceObject(value, level, options) {
  const indentation = getIndentString();
  const entries = Object.entries(value);
  const childIndent = indentation.repeat(level + 1);

  return entries
    .map(([key, childValue], index) => {
      const prefix = index === 0 ? `${indentation.repeat(level)}- ` : childIndent;
      const keyPrefix = `${prefix}${formatYamlKey(key)}:`;
      if (isYamlScalar(childValue)) {
        return `${keyPrefix} ${formatYamlScalar(childValue)}`;
      }

      return `${keyPrefix}\n${stringifyYaml(childValue, level + 2, options)}`;
    })
    .join("\n");
}

function isPlainYamlObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isYamlScalar(value) {
  return !value || typeof value !== "object";
}

function formatYamlKey(key) {
  return /^[A-Za-z_][\w.-]*$/.test(key) ? key : JSON.stringify(key);
}

function formatYamlScalar(value) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return shouldQuoteYamlString(value) ? JSON.stringify(value) : value;
  }

  return String(value);
}

function shouldQuoteYamlString(value) {
  return (
    !value ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /\s$|^\s/.test(value) ||
    /:\s/.test(value) ||
    /\s#/.test(value) ||
    /^(?:true|false|null|~)$/i.test(value) ||
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)
  );
}

function formatCss(input) {
  const tokens = tokenizeCss(input);
  validateCssTokens(tokens);
  const indentation = getIndentString();
  const lines = [];
  let level = 0;

  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const next = tokens[index + 1];

    if (token.type === "comment") {
      pushCssLine(lines, level, token.value.trim());
      return;
    }

    if (token.value === "{") {
      appendCssText(lines, " {", level);
      level += 1;
      return;
    }

    if (token.value === "}") {
      level = Math.max(0, level - 1);
      if (previous && previous.value !== "{" && previous.value !== ";" && previous.value !== "}") {
        appendCssText(lines, ";", level + 1);
      }
      pushCssLine(lines, level, "}");
      if (next && next.value !== "}") {
        lines.push("");
      }
      return;
    }

    if (token.value === ";") {
      appendCssText(lines, ";", level);
      return;
    }

    if (token.value === ":") {
      appendCssText(lines, isCssSelectorColon(tokens, index) ? ":" : ": ", level);
      return;
    }

    if (token.value === ",") {
      appendCssText(lines, ", ", level);
      return;
    }

    const text = normalizeCssText(token.value);
    if (previous && (previous.value === "{" || previous.value === ";" || previous.type === "comment")) {
      pushCssLine(lines, level, text);
    } else {
      appendCssText(lines, text, level);
    }
  });

  return lines
    .filter((line, index, allLines) => line || (allLines[index - 1] && allLines[index + 1]))
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function minifyCss(input) {
  const tokens = tokenizeCss(input);
  validateCssTokens(tokens);
  let output = "";

  tokens.forEach((token) => {
    if (token.type === "comment") {
      if (token.value.startsWith("/*!")) {
        output += token.value;
      }
      return;
    }

    if (token.type === "punctuation") {
      output = output.trimEnd();
      output += token.value;
      return;
    }

    const value = normalizeCssText(token.value);
    const previous = output[output.length - 1] || "";
    if (previous && needsCssSeparator(previous, value[0])) {
      output += " ";
    }
    output += value;
  });

  return output.trim();
}

function tokenizeCss(input) {
  const tokens = [];
  let buffer = "";
  let quote = null;
  let parenDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quote) {
      buffer += char;
      if (char === "\\" && next) {
        buffer += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }

    if (char === "/" && next === "*") {
      flushCssBuffer(tokens, buffer);
      buffer = "";
      const end = input.indexOf("*/", index + 2);
      if (end === -1) {
        throw new Error(`Unclosed CSS comment at line ${getLineAndColumn(input, index).line}`);
      }
      tokens.push({ type: "comment", value: input.slice(index, end + 2) });
      index = end + 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      buffer += char;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      buffer += char;
      continue;
    }

    if (!parenDepth && "{}:;,".includes(char)) {
      flushCssBuffer(tokens, buffer);
      buffer = "";
      tokens.push({ type: "punctuation", value: char });
      continue;
    }

    buffer += char;
  }

  if (quote) {
    throw new Error("Unclosed CSS string");
  }

  flushCssBuffer(tokens, buffer);
  return tokens;
}

function flushCssBuffer(tokens, buffer) {
  const value = normalizeCssText(buffer);
  if (value) {
    tokens.push({ type: "text", value });
  }
}

function validateCssTokens(tokens) {
  let depth = 0;

  tokens.forEach((token) => {
    if (token.value === "{") {
      depth += 1;
    }

    if (token.value === "}") {
      depth -= 1;
      if (depth < 0) {
        throw new Error("Unexpected CSS closing brace");
      }
    }
  });

  if (depth > 0) {
    throw new Error("Unclosed CSS block");
  }
}

function isCssSelectorColon(tokens, index) {
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.value === "{") {
      return true;
    }
    if (token.value === ";" || token.value === "}") {
      return false;
    }
  }

  return false;
}

function pushCssLine(lines, level, text) {
  lines.push(`${getIndentString().repeat(level)}${text}`);
}

function appendCssText(lines, text, level) {
  if (!lines.length || lines[lines.length - 1] === "") {
    pushCssLine(lines, level, text.trimStart());
    return;
  }

  lines[lines.length - 1] += text;
}

function normalizeCssText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function needsCssSeparator(previous, next) {
  return /[\w%)#.-]/.test(previous) && /[\w.#-]/.test(next);
}

function getIndent() {
  return indentSelect.value === "tab" ? "\t" : Number(indentSelect.value);
}

function getIndentString() {
  return indentSelect.value === "tab" ? "\t" : " ".repeat(Number(indentSelect.value));
}

function jsonValueToXmlDocument(value) {
  const rootName = getJsonRootName(value);
  const body = jsonValueToXml(value, rootName, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

function getJsonRootName(value) {
  if (Array.isArray(value)) {
    return "items";
  }

  return "root";
}

function jsonValueToXml(value, tagName, level) {
  const indentation = getIndentString();
  const safeTagName = toXmlTagName(tagName);
  const prefix = indentation.repeat(level);

  if (Array.isArray(value)) {
    if (!value.length) {
      return `${prefix}<${safeTagName}></${safeTagName}>`;
    }

    const childLines = value.map((item) => jsonValueToXml(item, "item", level + 1));
    return [
      `${prefix}<${safeTagName}>`,
      ...childLines,
      `${prefix}</${safeTagName}>`
    ].join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) {
      return `${prefix}<${safeTagName}></${safeTagName}>`;
    }

    const childLines = entries.map(([key, childValue]) => jsonValueToXml(childValue, key, level + 1));
    return [
      `${prefix}<${safeTagName}>`,
      ...childLines,
      `${prefix}</${safeTagName}>`
    ].join("\n");
  }

  if (value === null) {
    return `${prefix}<${safeTagName} null="true"></${safeTagName}>`;
  }

  return `${prefix}<${safeTagName}>${escapeXmlText(String(value))}</${safeTagName}>`;
}

function toXmlTagName(value) {
  const cleaned = String(value)
    .trim()
    .replace(/[^\w:.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleaned) {
    return "value";
  }

  return /^[A-Za-z_:]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function escapeXmlText(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getJsonErrorMessage(error) {
  const match = error.message.match(/position (\d+)/i);
  if (!match) {
    return error.message;
  }

  const position = Number(match[1]);
  const location = getLineAndColumn(sourceInput.value, position);
  return `Invalid JSON at line ${location.line}, column ${location.column}`;
}

function getLineAndColumn(text, position) {
  const before = text.slice(0, position);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}
