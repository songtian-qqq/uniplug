# __NAME__ (advanced template)

Everything a real plugin tends to need, already wired:

| Feature | Where |
|---|---|
| Service (`api.provide`) | `setup` step 1 |
| Event listener (`api.on`) | step 2 |
| Middleware (`api.hook`) | step 3 |
| Command (`api.command`) | step 4 |
| Persistent store + timer (`api.store`, `api.poll`) | step 5 |
| Cleanup (`api.dispose`) | step 6 |
| Lifecycle (`onEnable` / `onDisable` / `onUnload`) | bottom |

```bash
node ../../bin/uniplug.js list --dir .
node ../../bin/uniplug.js run __ID__:status
```

Read `docs/API.md` for the full api surface.
