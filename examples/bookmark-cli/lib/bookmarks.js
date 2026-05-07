import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function defaultStorePath() {
  return process.env.BOOKMARK_STORE ?? path.join(os.homedir(), ".bookmark-cli-example.json");
}

function readStore(storePath = defaultStorePath()) {
  if (!fs.existsSync(storePath)) return [];
  const raw = fs.readFileSync(storePath, "utf8").trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Bookmark store is not an array: ${storePath}`);
  return parsed;
}

function writeStore(bookmarks, storePath = defaultStorePath()) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(bookmarks, null, 2)}\n`, "utf8");
}

function normalizeUrl(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("URL must use http or https.");
  return parsed.toString();
}

export function addBookmark({ title, url }, storePath = defaultStorePath()) {
  if (!title?.trim()) throw new Error("Title is required.");
  const normalized = normalizeUrl(url);
  const bookmarks = readStore(storePath);
  if (bookmarks.some((bookmark) => bookmark.url === normalized)) throw new Error(`Bookmark already exists: ${normalized}`);
  const bookmark = { id: crypto.randomUUID(), title: title.trim(), url: normalized, createdAt: new Date().toISOString() };
  bookmarks.push(bookmark);
  writeStore(bookmarks, storePath);
  return bookmark;
}

export function listBookmarks(storePath = defaultStorePath()) {
  return readStore(storePath);
}

export function removeBookmark(idOrUrl, storePath = defaultStorePath()) {
  const bookmarks = readStore(storePath);
  const normalizedInput = (() => {
    try {
      return normalizeUrl(idOrUrl);
    } catch {
      return idOrUrl;
    }
  })();
  const next = bookmarks.filter((bookmark) => bookmark.id !== normalizedInput && bookmark.url !== normalizedInput);
  if (next.length === bookmarks.length) throw new Error(`Bookmark not found: ${idOrUrl}`);
  writeStore(next, storePath);
  return bookmarks.length - next.length;
}
