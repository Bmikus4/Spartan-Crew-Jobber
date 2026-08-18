# `npm run build` dies with EISDIR on this machine

    Error: EISDIR: illegal operation on a directory, readlink '...\app\api\auth\google\callback\route.ts'

The path in the message is a red herring — it is whichever regular file the resolver
happened to probe first. With `--turbopack` the same error lands on
`node_modules/styled-jsx/index.js` instead.

## Cause

Node 25 on Windows maps `readlink()` on a REGULAR FILE to `EISDIR`. Every other
platform and every earlier Node returns `EINVAL`, and both webpack's resolver and
Next's page-data collection catch `EINVAL` and rethrow anything else. So the build
dies on the first ordinary file it looks at.

Reproduce in one line, no Next involved:

    node -e "require('fs').readlinkSync('package.json')"   # EISDIR on node 25, EINVAL below it

## It does NOT affect production

Vercel builds on its own Node. Every deployment has been green throughout — checked
2026-08-18, 20 of 20 READY. This is a local-only failure.

## Fix

Use Node 20-24 locally. `package.json` now declares `engines: { node: ">=20 <25" }`,
which is also what tells Vercel which runtime to pick.

Nothing in the application needs changing, and nothing should be worked around in
application code: the day Node fixes the error mapping, or Next widens its catch, a
workaround would be the only thing left behind.
