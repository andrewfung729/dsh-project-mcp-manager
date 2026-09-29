# CLI: `dsh-mcp`

English | [中文](cli.zh.md)

[← README](../../README.md) ｜ Related: [configuration format](format.md) · [configuration sources and layers](layers.md) · [`${VAR}` expansion](env-expansion.md)

Command-line management for the **native** config files (writes only
`.dsh/mcp.yml` or `.dsh/mcp.json` — never the legacy `.mcp.json`; it does not
connect to a running dsh host, which converges via the file watchers).

`dsh-mcp` is **not** a `dsh` subcommand. `dsh mcp` boots a profile named `mcp`.
`dsh plugin add` does not put the bin on `PATH`. After a profile install, run
the real entry with `node` from the project directory (`$DSH_HOME` defaults to
`~/.dsh`). This does not require the executable bit:

```bash
node "$HOME/.dsh/profiles/web/node_modules/dsh-project-mcp-manager/lib/cli.js" trust
node "$HOME/.dsh/profiles/web/node_modules/dsh-project-mcp-manager/lib/cli.js" status
```

Executing `.bin/dsh-mcp` directly asks the kernel to execute `lib/cli.js`.
`tsc` writes that file as `644`/`664` under a normal umask, so bash reports
`Permission denied`. This package's build chmods it to `755`. For an already
installed copy, use the `node` command above, or `chmod +x` the file. On
Windows the shim is `dsh-mcp.cmd` in that same `.bin` directory. Do not use
`pnpm --dir <profile> exec dsh-mcp trust` without a path: `--dir` changes the
working directory, so a bare `trust` registers the profile directory.

```powershell
dsh-mcp add gitlab npx -y @modelcontextprotocol/server-gitlab -e GITLAB_TOKEN=${GITLAB_TOKEN}
dsh-mcp add --transport http sentry https://mcp.sentry.dev/mcp -H "Authorization: Bearer ${SENTRY_TOKEN}"
dsh-mcp add --scope user shared node ./tools/shared.js        # writes ~/.dsh/mcp.yml
dsh-mcp add --format json jsonproj node ./tools/p.js          # writes <projectRoot>/.dsh/mcp.json
dsh-mcp add --scope profile --profile web shared node ./s.js   # writes ~/.dsh/profiles/web/mcp.json
dsh-mcp list          # all source layers, with shadow annotations
dsh-mcp get gitlab    # winning-layer entry; secret values shown as key names only
dsh-mcp remove gitlab # searches yml then json in priority order and deletes; read-only layers get edit guidance
dsh-mcp status        # layer row counts, names, and diagnostic summary (no host connection)
dsh-mcp import --from .cursor/mcp.json --dry-run   # preview mcpServers import; no writes
```

Scopes: `--scope project` (default; writes `<projectRoot>/.dsh/mcp.yml` under
the nearest `.git` ancestor), `--scope user` (writes `~/.dsh/mcp.yml`) and
`--scope profile` (requires `--profile <name>`; writes
`~/.dsh/profiles/<name>/mcp.json`, JSON only).
**Write format**: `--format yml|json` takes precedence over the
`DSH_MCP_CLI_FORMAT` environment variable (`yml`|`json`, default `yml`); with
`--format json`, project and user scopes write `.dsh/mcp.json` and
`~/.dsh/mcp.json` respectively. `add`'s default `cwd` follows the scope: `"."`
(the project root) for project, `""` (the host directory) for user/profile;
`-c` overrides it explicitly.

`add` does not take `--allow` / `--deny`. Per-entry `tools.allow` /
`tools.deny` (and JSON `includeTools` / `excludeTools`) must be written in
the config file or brought in with `dsh-mcp import`. `list` and `get` still
show those filters (pattern text only).

**`status`** reads the six source layers and the diagnostic files
(`<projectRoot>/.dsh/.mcp-diag.json` and `$DSH_HOME/.mcp-diag.json`). It
prints each layer's row count and names, then the latest `summary`
(mounted / skipped / unhealthy / idle-not-mounted / tool-budget hits). It does not inspect host memory: if the
host has never reconciled, the files are absent and the command reports
that. `--scope project|user|profile` filters which layers are listed and which
diagnostic file is printed (project `.dsh/.mcp-diag.json` vs
`$DSH_HOME/.mcp-diag.json`). `--scope profile` lists only profile layers
(add `--profile <name>` to keep one); `--scope user` still lists every
user-layer file, including all profiles. Idle catalog rows print as
not-mounted (no session), not as unhealthy.

**`import`** copies `{"mcpServers":{...}}` into a native yml or JSON file
(`--scope` / `--format` / `--profile` match `add`; default scope is
**project**). Same-name keys are skipped unless `--overwrite` is set
(the skip/overwrite decision runs inside the file lock, matching `add`).
`--dry-run` prints the add/skip/overwrite plan and any shadow conflicts
(`shadowViewOf`) without writing. VS Code `{servers:{…}}`, a bare entry
object, and a JSON array are rejected. Bad entries are reported one by
one; valid siblings still import. `--from -` reads stdin.

There is no `local` scope — `--scope local`
fails with an explanation. `--transport` accepts `stdio` (default) and `http`;
the MCP SSE endpoint transport (`sse`) is refused with an actionable error
(change `type` to `"http"`, or drop `type` and keep `url`).

**Reserved short flags**: besides `-s`/`-t`/`-e`/`-H`/`-c`/`-h`, since v0.4.0
`-f` (`--format`) and `-p` (`--profile`) are CLI options too. Both consume the
next token as their value, so pass them to the spawned server command after `--`
(everything after `--` is treated as a positional argument). `--from`,
`--dry-run` and `--overwrite` are reserved for `import`. Any other unknown
`-` token is still forwarded to the server command line verbatim.

**Ownership contract**: JSON files belong exclusively to this CLI (the host
plugin never writes them). Writes keep other top-level keys and key order,
refuse to overwrite a file that fails to parse, and are atomic; `${VAR}`
references are written through literally so secrets stay in the environment
(see [`${VAR}` expansion](env-expansion.md)). The yml side goes through the
managed block, so content outside the begin/end markers is preserved
byte-for-byte.
