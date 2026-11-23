// A faster drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// run(input) returns the same output tree makefun-site's build returns, byte for byte.
// Written for speed: index scanners instead of split, escaping only where a special character
// appears, compiled templates instead of a tree walk, and caches for slugs and word counts.

// ------------------------------------------------------------------ text

const AMP = 38,
  LT = 60,
  GT = 62,
  QUOT = 34,
  APOS = 39;

function escapeCh(code) {
  switch (code) {
    case AMP:
      return "&amp;";
    case LT:
      return "&lt;";
    case GT:
      return "&gt;";
    case QUOT:
      return "&quot;";
    case APOS:
      return "&#39;";
    default:
      return String.fromCharCode(code);
  }
}

/** `text` with & < > " and ' escaped. */
function escapeHtml(text) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === AMP || c === LT || c === GT || c === QUOT || c === APOS) break;
    i++;
  }
  if (i === n) return text;
  const out = [text.slice(0, i)];
  let start = i;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === AMP || c === LT || c === GT || c === QUOT || c === APOS) {
      if (i > start) out.push(text.slice(start, i));
      out.push(escapeCh(c));
      i++;
      start = i;
    } else i++;
  }
  if (start < n) out.push(text.slice(start));
  return out.join("");
}

const SLUG_MAX = 64;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const slugCache = new Map();

/** The slug of `text` (NFKD, combining marks dropped, a-z0-9 runs joined by "-", at most 64). */
function slugify(text) {
  const cached = slugCache.get(text);
  if (cached !== undefined) return cached;
  let plain;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      ascii = false;
      break;
    }
  }
  if (ascii) plain = text;
  else plain = text.normalize("NFKD").replace(/\p{M}/gu, "");
  let out = "";
  let gap = false;
  let started = false;
  for (let i = 0; i < plain.length; i++) {
    const c = plain.charCodeAt(i);
    let keep = null;
    if (c >= 65 && c <= 90) keep = String.fromCharCode(c + 32);
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = plain[i];
    else if (c > 127) {
      // a code point outside ASCII that the NFKD pass left alone
      keep = null;
    }
    if (keep === null || keep.length === 0) {
      gap = started;
      continue;
    }
    if (gap) out += "-";
    gap = false;
    started = true;
    out += keep;
  }
  out = out.length > SLUG_MAX ? out.slice(0, SLUG_MAX).replace(/-+$/, "") : out.replace(/-+$/, "");
  if (out === "") out = "untitled";
  if (slugCache.size < 20000) slugCache.set(text, out);
  return out;
}

/** `slug` made unique against `taken` (and added to it). */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/** A YYYY-MM-DD date in words. */
function longDate(date) {
  const d = Number(date.slice(8, 10));
  const m = Number(date.slice(5, 7));
  return `${d} ${MONTHS[m - 1]} ${date.slice(0, 4)}`;
}

// ------------------------------------------------------------------ front matter

const KEYS = ["title", "date", "tags", "draft", "layout", "slug", "summary"];
const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;
const BLANK_LINE = /^[ \t]*$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: "a quoted string is not closed" };
    let out = "";
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === "\\") {
        const nx = raw[i + 1];
        if ((nx !== '"' && nx !== "\\") || i + 1 === raw.length - 1) return { error: "a quoted string holds an escape other than \\\" or \\\\" };
        out += nx;
        i++;
      } else if (c === '"') return { error: "a quoted string holds a stray quote" };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: "a bare string opens on [" };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case "title":
    case "summary": {
      const s = stringOf(raw);
      return "error" in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case "date": {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case "tags": {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === "") return { value: [] };
      const tags = inner.split(",").map((t) => t.trim());
      if (tags.some((t) => t === "" || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case "draft":
      return raw === "true" ? { value: true } : raw === "false" ? { value: false } : { error: 'key "draft": true or false' };
    case "layout":
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case "slug":
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/** A source's front matter and body, or the first reason it is refused. */
function parseFrontMatter(text) {
  if (!text.startsWith("---\n")) {
    if (text !== "---") return { error: "no front matter" };
  }
  let i = text === "---" ? text.length : 4;
  let close = -1;
  let bodyStart = -1;
  while (i <= text.length) {
    const nl = text.indexOf("\n", i);
    const lineEnd = nl === -1 ? text.length : nl;
    if (lineEnd - i === 3 && text.charCodeAt(i) === 45 && text.charCodeAt(i + 1) === 45 && text.charCodeAt(i + 2) === 45) {
      close = i;
      bodyStart = nl === -1 ? text.length : nl + 1;
      break;
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  if (close === -1) return { error: "the front matter is not closed" };
  const data = {};
  let lineNo = 1;
  i = 4;
  while (i < close) {
    const nl = text.indexOf("\n", i);
    const lineEnd = nl === -1 || nl > close ? close : nl;
    lineNo++;
    const line = text.slice(i, lineEnd);
    i = lineEnd + 1;
    if (line === "" || BLANK_LINE.test(line) || line.charCodeAt(0) === 35) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${lineNo} is not "key: value"` };
    const key = m[1];
    let raw = m[2] === undefined ? "" : m[2];
    const rawLen = raw.length;
    let end = rawLen;
    while (end > 0) {
      const c = raw.charCodeAt(end - 1);
      if (c === 32 || c === 9) end--;
      else break;
    }
    if (end !== rawLen) raw = raw.slice(0, end);
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === "") return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ("error" in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, "title")) return { error: "no title" };
  return { data, body: text.slice(bodyStart) };
}

// ------------------------------------------------------------------ markdown

const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === "" ? null : { depth: m[1].length, text: m[2] };
}

function endsParagraph(line) {
  return BLANK_LINE.test(line) || FENCE_OPEN.test(line) || headingOf(line) !== null || HR.test(line);
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c === 32 || c === 9) a++;
    else break;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c === 32 || c === 9) b--;
    else break;
  }
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** `src`'s block tokens, in order. */
function lex(src) {
  const tokens = [];
  const n = src.length;
  let pos = 0;
  while (pos <= n) {
    if (pos === n) break;
    let nl = src.indexOf("\n", pos);
    const lineEnd = nl === -1 ? n : nl;
    const line = src.slice(pos, lineEnd);
    if (BLANK_LINE.test(line)) {
      pos = lineEnd + 1;
      continue;
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence !== null) {
      const body = [];
      pos = lineEnd + 1;
      while (pos < n) {
        let l2 = src.indexOf("\n", pos);
        const e2 = l2 === -1 ? n : l2;
        const line2 = src.slice(pos, e2);
        if (FENCE_CLOSE.test(line2)) break;
        body.push(line2);
        pos = e2 + 1;
      }
      if (pos < n) {
        let l2 = src.indexOf("\n", pos);
        pos = l2 === -1 ? n : l2 + 1;
      } else pos = n;
      tokens.push({ type: "code", lang: fence[1], lines: body });
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      tokens.push({ type: "heading", depth: heading.depth, text: heading.text });
      pos = lineEnd + 1;
      continue;
    }
    if (HR.test(line)) {
      tokens.push({ type: "hr" });
      pos = lineEnd + 1;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (pos < n) {
        let l2 = src.indexOf("\n", pos);
        const e2 = l2 === -1 ? n : l2;
        const line2 = src.slice(pos, e2);
        if (line2.charCodeAt(0) !== 62) break;
        body.push(trimLine(line2.charCodeAt(1) === 32 ? line2.slice(2) : line2.slice(1)));
        pos = e2 + 1;
      }
      tokens.push({ type: "blockquote", lines: body.filter((l) => l !== "") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const marker = isOrdered ? ORDERED : BULLET;
      const items = [];
      while (pos < n) {
        let l2 = src.indexOf("\n", pos);
        const e2 = l2 === -1 ? n : l2;
        const line2 = src.slice(pos, e2);
        const m = marker.exec(line2);
        if (m !== null) {
          items.push([trimLine(isOrdered ? m[2] : m[1])]);
          pos = e2 + 1;
        } else if (CONTINUED.test(line2)) {
          items[items.length - 1].push(trimLine(line2));
          pos = e2 + 1;
        } else break;
      }
      tokens.push({ type: "list", ordered: isOrdered, start: isOrdered ? Number(ordered[1]) : 1, items: items.map((parts) => parts.join("\n")) });
      continue;
    }
    const body = [trimLine(line)];
    pos = lineEnd + 1;
    while (pos < n) {
      let l2 = src.indexOf("\n", pos);
      const e2 = l2 === -1 ? n : l2;
      const line2 = src.slice(pos, e2);
      const c0 = line2.length === 0 ? 32 : line2.charCodeAt(0);
      if ((c0 === 32 || c0 === 9 || c0 === 96 || c0 === 35 || c0 === 45 || c0 === 42) && endsParagraph(line2)) break;
      body.push(trimLine(line2));
      pos = e2 + 1;
    }
    tokens.push({ type: "paragraph", text: body.join("\n") });
  }
  return tokens;
}

const ESCAPABLE = new Set([92, 96, 42, 95, 91, 93, 40, 41, 35, 43, 45, 46, 33, 62]);

function findUnescaped(s, what, from) {
  const len = s.length;
  const w0 = what.charCodeAt(0);
  const wl = what.length;
  for (let j = from; j <= len - wl; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < len && ESCAPABLE.has(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c === w0) {
      let k = 1;
      while (k < wl && s.charCodeAt(j + k) === what.charCodeAt(k)) k++;
      if (k === wl) return j;
    }
  }
  return -1;
}

function findSingleStar(s, from) {
  const len = s.length;
  for (let j = from; j < len; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < len && ESCAPABLE.has(s.charCodeAt(j + 1))) {
      j++;
      continue;
    }
    if (c !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

const WS = /\s/;

function isSpaceCode(c) {
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  if (c === 160 || c === 5760 || c === 8239 || c === 8232 || c === 8233 || c === 65279 || c === 12288) return true;
  return c >= 8192 && c <= 8202;
}

const SPECIAL_CHARS = [92, 96, 42, 91, 38, 60, 62, 34, 39];
const SPECIAL_CLASS = "[" + SPECIAL_CHARS.map((c) => "\\u" + c.toString(16).padStart(4, "0")).join("") + "]";
const SPECIAL_SCAN = new RegExp(SPECIAL_CLASS, "g");
const SPECIAL_TEST = new RegExp(SPECIAL_CLASS);

/** `s` rendered inline; `env.link(target)` is a link's href. */
function inline(s, env) {
  if (!SPECIAL_TEST.test(s)) return s;
  const n = s.length;
  let out = "";
  let start = 0;
  SPECIAL_SCAN.lastIndex = 0;
  let m;
  while ((m = SPECIAL_SCAN.exec(s)) !== null) {
    const i = m.index;
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < n && ESCAPABLE.has(s.charCodeAt(i + 1))) {
        if (i > start) out += s.slice(start, i);
        out += escapeCh(s.charCodeAt(i + 1));
        start = i + 2;
      } else {
        if (i > start) out += s.slice(start, i);
        out += "\\";
        start = i + 1;
      }
      SPECIAL_SCAN.lastIndex = start;
      continue;
    }
    if (c === 96) {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1) {
        if (i > start) out += s.slice(start, i);
        out += "<code>" + escapeHtml(s.slice(i + 1, j)) + "</code>";
        start = j + 1;
      } else {
        if (i > start) out += s.slice(start, i);
        out += "`";
        start = i + 1;
      }
      SPECIAL_SCAN.lastIndex = start;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, "**", i + 2);
        if (j > i + 2) {
          if (i > start) out += s.slice(start, i);
          var saveS = SPECIAL_SCAN.lastIndex;
          out += "<strong>" + inline(s.slice(i + 2, j), env) + "</strong>";
          SPECIAL_SCAN.lastIndex = saveS;
          start = j + 2;
        } else {
          if (i > start) out += s.slice(start, i);
          out += "**";
          start = i + 2;
        }
        SPECIAL_SCAN.lastIndex = start;
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        if (i > start) out += s.slice(start, i);
        var saveE = SPECIAL_SCAN.lastIndex;
        out += "<em>" + inline(s.slice(i + 1, j), env) + "</em>";
        SPECIAL_SCAN.lastIndex = saveE;
        start = j + 1;
      } else {
        if (i > start) out += s.slice(start, i);
        out += "*";
        start = i + 1;
      }
      SPECIAL_SCAN.lastIndex = start;
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(s, "]", i + 1);
      const j = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(")", k + 2) : -1;
      const target = j === -1 ? "" : s.slice(k + 2, j);
      if (target !== "" && !WS.test(target)) {
        if (i > start) out += s.slice(start, i);
        var saveL = SPECIAL_SCAN.lastIndex;
        out += '<a href="' + escapeHtml(env.link(target)) + '">' + inline(s.slice(i + 1, k), env) + "</a>";
        SPECIAL_SCAN.lastIndex = saveL;
        start = j + 1;
      } else {
        if (i > start) out += s.slice(start, i);
        out += "[";
        start = i + 1;
      }
      SPECIAL_SCAN.lastIndex = start;
      continue;
    }
    if (i > start) out += s.slice(start, i);
    out += escapeCh(c);
    start = i + 1;
    SPECIAL_SCAN.lastIndex = start;
  }
  if (start < n) out += s.slice(start);
  return out;
}

/** `src` rendered: its HTML, its table of contents and its excerpt. */
function renderMarkdown(src, env) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  const tokens = lex(src);
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    switch (tok.type) {
      case "heading": {
        const id = uniqueSlug(slugify(tok.text), ids);
        const html = inline(tok.text, env);
        blocks.push(`<h${tok.depth} id="${id}">${html}</h${tok.depth}>`);
        if (tok.depth === 2 || tok.depth === 3) toc.push({ level: tok.depth, id, html });
        break;
      }
      case "code": {
        const cls = tok.lang === "" ? "" : ` class="language-${escapeHtml(tok.lang)}"`;
        let inner = "";
        for (let k = 0; k < tok.lines.length; k++) inner += escapeHtml(tok.lines[k]) + "\n";
        blocks.push(`<pre><code${cls}>${inner}</code></pre>`);
        break;
      }
      case "hr":
        blocks.push("<hr>");
        break;
      case "blockquote":
        blocks.push(tok.lines.length === 0 ? "<blockquote>\n</blockquote>" : `<blockquote>\n<p>${inline(tok.lines.join("\n"), env)}</p>\n</blockquote>`);
        break;
      case "list": {
        const tag = tok.ordered ? "ol" : "ul";
        const open = tok.ordered && tok.start !== 1 ? `<ol start="${tok.start}">` : `<${tag}>`;
        let items = "";
        for (let k = 0; k < tok.items.length; k++) items += `<li>${inline(tok.items[k], env)}</li>\n`;
        blocks.push(`${open}\n${items}</${tag}>`);
        break;
      }
      case "paragraph": {
        const html = inline(tok.text, env);
        if (excerpt === null) excerpt = html;
        blocks.push(`<p>${html}</p>`);
        break;
      }
    }
  }
  let html = "";
  for (let k = 0; k < blocks.length; k++) html += blocks[k] + "\n";
  return { html, toc, excerpt: excerpt === null ? "" : excerpt };
}

// ------------------------------------------------------------------ templates

const INCLUDE_DEPTH = 8;
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;
const ONLY_BLANKS = /^[ \t]*$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split(".");
}

function tokenize(name, src) {
  const tokens = [];
  let text = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const open = src.indexOf("{", i);
    if (open === -1 || open === n - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== "{" && next !== "%") {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === "{") {
      const raw = src[open + 2] === "{";
      const close = src.indexOf(raw ? "}}}" : "}}", open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? "{{{" : "{{"} is not closed`);
      if (text !== "") tokens.push({ t: "text", text });
      text = "";
      tokens.push({ t: raw ? "raw" : "var", path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf("%}", open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf("\n", open - 1) + 1;
    const nl = src.indexOf("\n", end);
    const lineEnd = nl === -1 ? n : nl;
    const standalone = ONLY_BLANKS.test(src.slice(lineStart, open)) && ONLY_BLANKS.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== "") tokens.push({ t: "text", text });
    text = "";
    tokens.push({ t: "tag", tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? n : nl + 1) : end;
  }
  if (text !== "") tokens.push({ t: "text", text });
  return tokens;
}

/** `src` parsed into its tree of nodes. */
function parseTemplate(name, src) {
  const root = { kind: "root", body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === "text") body.push({ kind: "text", text: tok.text });
    else if (tok.t === "var" || tok.t === "raw") body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: "for", name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: "if", not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === "else") {
        if (top.kind !== "if" || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === "endfor" || tag === "endif") {
        if (top.kind !== (tag === "endfor" ? "for" : "if")) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === "root" ? parent.body : parent.kind === "for" ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: "include", name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain. */
function lookup(scope, path) {
  const first = path[0];
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, first)) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[first];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== "object" || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    let out = "";
    for (let k = 0; k < v.length; k++) out += (k === 0 ? "" : ", ") + textOf(v[k]);
    return out;
  }
  return "";
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== "" && v !== 0;
}

/** A node list compiled to one render function (scope, ctx, depth) -> string. */
function compileNodes(nodes) {
  const fns = new Array(nodes.length);
  for (let k = 0; k < nodes.length; k++) fns[k] = compileNode(nodes[k]);
  return (scope, ctx, depth) => {
    let out = "";
    for (let k = 0; k < fns.length; k++) out += fns[k](scope, ctx, depth);
    return out;
  };
}

function compileNode(n) {
  switch (n.kind) {
    case "text": {
      const t = n.text;
      return () => t;
    }
    case "var": {
      const p = n.path;
      return (scope, ctx) => escapeHtml(textOf(lookup(scope, p)));
    }
    case "raw": {
      const p = n.path;
      return (scope) => textOf(lookup(scope, p));
    }
    case "if": {
      const p = n.path;
      const not = n.not;
      const thenFn = compileNodes(n.then);
      const elseFn = n.else === null ? null : compileNodes(n.else);
      return (scope, ctx, depth) => {
        const v = truthy(lookup(scope, p));
        if (v !== not) return thenFn(scope, ctx, depth);
        return elseFn === null ? "" : elseFn(scope, ctx, depth);
      };
    }
    case "for": {
      const p = n.path;
      const name = n.name;
      const bodyFn = compileNodes(n.body);
      return (scope, ctx, depth) => {
        const xs = lookup(scope, p);
        if (!Array.isArray(xs)) return "";
        let out = "";
        const len = xs.length;
        for (let k = 0; k < len; k++) {
          out += bodyFn({ vars: { [name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === len - 1, length: len } }, parent: scope }, ctx, depth);
        }
        return out;
      };
    }
    case "include": {
      const name = n.name;
      return (scope, ctx, depth) => {
        const t = ctx.templates.get(name);
        if (t === undefined || depth >= INCLUDE_DEPTH) return "";
        return t(scope, ctx, depth + 1);
      };
    }
    default:
      return () => "";
  }
}

// ------------------------------------------------------------------ the build

const REPORT_FILE = "build-report.txt";
const RESERVED = ["posts", "tags", "page"];
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const CRLF = /\r\n?/g;

const WS_TABLE = new Uint8Array(65536);
for (let k = 0; k < 65536; k++) {
  const c = k;
  WS_TABLE[c] = c === 32 || (c >= 9 && c <= 13) ? 1 : c < 128 ? 0 : k === 160 || k === 5760 || k === 8239 || k === 8232 || k === 8233 || k === 65279 || k === 12288 || (k >= 8192 && k <= 8202) ? 1 : 0;
}

function wordsOf(text) {
  let count = 0;
  let inWord = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    if (WS_TABLE[text.charCodeAt(i)] === 1) inWord = false;
    else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

function resolvePath(dir, rel) {
  const parts = dir === "" ? [] : dir.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function linkOf(s) {
  return s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? "", date_long: s.data.date === undefined ? "" : longDate(s.data.date) };
}

function cardOf(s) {
  if (s.card !== undefined) return s.card;
  const tags = s.tagRefs;
  const tagOut = new Array(tags.length);
  for (let k = 0; k < tags.length; k++) tagOut[k] = { name: tags[k].name, slug: tags[k].slug, url: tags[k].url };
  const card = {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? "",
    date_long: s.data.date === undefined ? "" : longDate(s.data.date),
    summary: s.data.summary ?? "",
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: tagOut,
  };
  s.card = card;
  return card;
}

function pageOf(s) {
  const card = cardOf(s);
  const tocOut = new Array(s.toc.length);
  for (let k = 0; k < s.toc.length; k++) tocOut[k] = { level: s.toc[k].level, id: s.toc[k].id, html: s.toc[k].html };
  return {
    ...card,
    slug: s.slug,
    content: s.html,
    toc: tocOut,
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

/** One site's output tree: path -> text. */
export function run(input) {
  const report = [];
  const templates = new Map();
  const templateNames = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of templateNames) {
    try {
      templates.set(name, compileNodes(parseTemplate(name, input.templates[name])));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, "");

  // 1. sources and statics
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    if (f.path.endsWith(".md")) sources.push({ path: f.path, text: CRLF.test(f.content) ? f.content.replace(CRLF, "\n") : f.content });
    else statics.push({ path: f.path, content: f.content });
  }

  // 2. front matter
  const kept = [];
  for (let k = 0; k < sources.length; k++) {
    const s = sources[k];
    const fm = parseFrontMatter(s.text);
    if ("error" in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith("posts/");
    let own;
    for (let d = 0; d < RESERVED.length; d++) {
      const dir = RESERVED[d];
      if (dir !== "posts" && s.path.startsWith(dir + "/")) {
        own = dir;
        break;
      }
    }
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, "date")) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? "post" : "page");
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  const live = kept;

  // 3. permalinks
  const taken = new Map();
  const bySource = new Map();
  for (let k = 0; k < live.length; k++) {
    const s = live[k];
    const dir = s.post ? "posts" : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === "" ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === "" ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. markdown
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (let k = 0; k < live.length; k++) {
    const s = live[k];
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (SCHEME.test(target) || target.startsWith("/") || target.startsWith("#")) return target;
        const hash = target.indexOf("#");
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? "" : target.slice(hash);
        const p = rel === "" ? null : resolvePath(dir, rel);
        if (p !== null && bySource.has(p)) return `${bySource.get(p).url}${frag}`;
        if (p !== null && staticPaths.has(p)) return `${base}/${p}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. posts
  const posts = live.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. tags
  const bySlugTag = new Map();
  for (let k = 0; k < posts.length; k++) {
    const p = posts[k];
    p.tagRefs = [];
    const names = p.data.tags ?? [];
    const seen = new Set();
    for (let j = 0; j < names.length; j++) {
      const name = names[j];
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = bySlugTag.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlugTag.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (let k = 0; k < live.length; k++) {
    const s = live[k];
    if (s.post) continue;
    const names = s.data.tags ?? [];
    const seen = new Set();
    const refs = [];
    for (let j = 0; j < names.length; j++) {
      const name = names[j];
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      refs.push(bySlugTag.get(slug) ?? { name, slug, url: "", posts: [] });
    }
    s.tagRefs = refs;
  }
  const tags = [...bySlugTag.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. layouts
  const output = {};
  const cards = new Map();
  for (let k = 0; k < posts.length; k++) cards.set(posts[k], cardOf(posts[k]));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const ctx = { templates };
  const baseVars = { site, tags: allTags, recent };
  const render = (name, vars) => {
    const t = templates.get(name);
    if (t === undefined) return null;
    return t({ vars: { ...baseVars, ...vars }, parent: null }, ctx, 0);
  };
  for (let k = 0; k < live.length; k++) {
    const s = live[k];
    output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render("index", {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? "" : indexUrl(k - 1), older_url: k === pages ? "" : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? "index.html" : `page/${k}/index.html`] = html;
  }
  for (let k = 0; k < tags.length; k++) {
    const t = tags[k];
    const html = render("tag", {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) },
    });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render("tags", {});
  if (tagsHtml !== null) output["tags/index.html"] = tagsHtml;
  for (let k = 0; k < statics.length; k++) {
    const f = statics[k];
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. report
  const lines = [...report, ...broken].sort(byCodeUnits);
  let pageCount = 0;
  for (let k = 0; k < live.length; k++) if (!live[k].post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join("\n")}\n`;
  return output;
}
