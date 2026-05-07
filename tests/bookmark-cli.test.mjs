import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addBookmark, listBookmarks, removeBookmark } from "../examples/bookmark-cli/lib/bookmarks.js";

test("bookmark CLI library adds, lists, and removes bookmarks", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bookmark-cli-"));
  const storePath = join(tempDir, "bookmarks.json");

  try {
    const bookmark = addBookmark({ title: "OpenAI", url: "https://openai.com" }, storePath);
    assert.equal(bookmark.title, "OpenAI");
    assert.equal(bookmark.url, "https://openai.com/");
    assert.equal(listBookmarks(storePath).length, 1);

    assert.equal(removeBookmark("https://openai.com/", storePath), 1);
    assert.deepEqual(listBookmarks(storePath), []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
