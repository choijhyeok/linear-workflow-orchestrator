#!/usr/bin/env node
import { addBookmark, listBookmarks, removeBookmark } from "../lib/bookmarks.js";

function usage() {
  return [
    "Usage:",
    "  bookmark add <title> <url>",
    "  bookmark list",
    "  bookmark remove <id-or-url>",
  ].join("\n");
}

function printList(bookmarks) {
  if (!bookmarks.length) {
    console.log("No bookmarks.");
    return;
  }
  for (const bookmark of bookmarks) {
    console.log(`${bookmark.id}\t${bookmark.title}\t${bookmark.url}`);
  }
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "add") {
    const [title, url] = args;
    const bookmark = addBookmark({ title, url });
    console.log(`Added ${bookmark.id}`);
    return;
  }
  if (command === "list") {
    printList(listBookmarks());
    return;
  }
  if (command === "remove") {
    const [idOrUrl] = args;
    if (!idOrUrl) throw new Error("id-or-url is required.");
    const count = removeBookmark(idOrUrl);
    console.log(`Removed ${count} bookmark${count === 1 ? "" : "s"}.`);
    return;
  }
  console.log(usage());
  process.exitCode = command ? 1 : 0;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
