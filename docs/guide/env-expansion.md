# `${VAR}` expansion

English | [中文](env-expansion.zh.md)

[← README](../../README.md) ｜ Related: [configuration format](format.md) · [configuration sources and layers](layers.md) · [CLI `dsh-mcp`](cli.md)

`${VAR}` references (matching `\$\{[A-Za-z_][A-Za-z0-9_]*\}` anywhere in the
string) in `command`, `args[*]`, `env[*]`, `cwd`, `url` and `headers[*]` — from
**any** of the sources above — are **interpolated** from the dsh host
process environment at mount time (same semantics as Claude Code, so
`"Authorization": "Bearer ${TOKEN}"` works). An unset or empty variable makes
the row skip with an `env-missing` diagnostic naming the variable (never its
value); a literal `${NAME}` that must survive unexpanded is not expressible.
A `url` containing a reference is accepted by the pre-mount schema in any
position — including the host part, e.g. `https://${HOST}/mcp` — because
validity is judged only after expansion: expanded inputs are re-validated
against the mount schema before spawn, and a malformed result (e.g. a non-URL
`${GATEWAY}/mcp`) skips the row with an `env-invalid` diagnostic instead of
reaching the mount backend. In the snapshot/row views, `fiberPhase` stays on
the mount-lifecycle vocabulary (`pending` for a row that never mounted) and
the reason rides on a separate `skipReason` field (`env-missing` /
`env-invalid` / `config-invalid` / `plugin-throw`; other skip reasons such as
`name-taken`, `idle` and `give-up` are described in
[configuration sources and layers](layers.md)). Values are never
persisted anywhere by the plugin; the CLI writes `${VAR}` through literally,
so secrets can live in the environment while configs live in git.

**Credential masking.** Credential-suffixed variable names (matching
`(API_?KEY|TOKEN|SECRET|PASSWO?RD|CREDENTIALS?|PRIVATE_?KEY)$`, case
insensitive) are **not expanded by default** — project config files ship with
the repository, so `Bearer ${GITHUB_TOKEN}` in a cloned file is an exfiltration
channel into the spawned process or the remote endpoint. A masked reference
skips the row with an `env-blocked` diagnostic naming the variable (never its
value). Setting `DSH_MCP_EXPAND_ALLOW=NAME1,NAME2` switches to a strict
allowlist: only listed names expand, everything else (credential or not)
skips as `env-blocked`.
