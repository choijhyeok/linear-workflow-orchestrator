# Bookmark CLI Example

Small real project used to dogfood the Linear Workflow Orchestrator plugin.

```bash
node bin/bookmark.js add "OpenAI" https://openai.com
node bin/bookmark.js list
node bin/bookmark.js remove https://openai.com/
```

Set `BOOKMARK_STORE=/tmp/bookmarks.json` to control where bookmarks are stored during tests.
