<!-- Modified from Spotify Shunt: use the Pi CLI for both workers. See NOTICE. -->
# shunt

A Claude Code plugin that uses the open source [Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) for bulk reads and code generation.

Shunt keeps large source files and generated code out of the parent agent's context. Pi still processes those files. Provider use and cost depend on your selected model. Reduced parent context does not mean reduced total token use or cost.

## How it works

The plugin keeps three layers from [Spotify Shunt](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt):

1. Hooks load worker routing at session start and block large file reads.
2. Bash scripts send files and instructions to Pi, then check the response with `jq`.
3. Skills explain when and how to call the scripts.

Each script starts one Pi process in JSON mode. It sends the prompt through stdin and does not save a session. The worker cannot use tools, extensions, skills, prompt templates, or automatic project instruction files. It can use only the files and instructions in the request.

The public scripts share argument handling, prompt preparation, and Pi calls in [`scripts/lib/pi.sh`](scripts/lib/pi.sh).
That helper also checks responses, applies the timeout, and cleans up worker processes. Shunt does not require Python.

The bulk reader returns an answer. The code writer returns code or writes it to `--target`. The wrapper writes the target only after Pi returns a successful, complete response. Pi does not edit the project directly.

The worker prompts require source evidence, exact comparison operands, and contract coverage for generated tests.
The parent reviews the result and checks the relevant source or tests.

## Setup

Shunt requires Bash 3.2 or later, `jq`, Pi, and standard macOS or Linux command utilities. The current Pi package is:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Start `pi`. Use `/login` to select and authenticate a provider. Select the worker model in the plugin settings file below. If Pi already works, Shunt uses that login.

Shunt loads its own [Pi settings file](.pi/settings.json) for both workers. It requires Pi support for `--approve` and `--no-context-files`. This version was tested with Pi `0.84.2`.

Add the repository marketplace and install Shunt:

```bash
claude plugin marketplace add Kotivskyi/skills
claude plugin install shunt@kotivskyi-skills
```

Restart Claude Code after installation. See the [Claude Code installation guide](https://code.claude.com/docs/en/discover-plugins).

To apply a new Shunt release to an installed copy:

```bash
claude plugin marketplace update kotivskyi-skills
claude plugin update shunt@kotivskyi-skills
```

Restart Claude Code to load the updated hooks and skills. See the [plugin CLI reference](https://code.claude.com/docs/en/plugins-reference).

For local development and direct settings edits, load Shunt from a repository clone:

```bash
claude --plugin-dir ./plugins/shunt
```

Run this command from the repository root. It loads the plugin for that session.
For another project, pass the absolute plugin path.

## Scripts

These examples start from the repository root. Plugin skills use `${CLAUDE_PLUGIN_ROOT}` to locate the scripts.

| Script | Required options | Optional options | Result |
| --- | --- | --- | --- |
| [`bulk-read.sh`](scripts/bulk-read.sh) | `--question`, `--paths` | None | Answer on stdout. |
| [`code-write.sh`](scripts/code-write.sh) | `--spec`, `--reference` | `--target` | Code on stdout, or one complete target file. |

Both file options accept one or more paths. Repeated file options append paths in order.
Repeated question, spec, or target options use the last value. Quote paths that contain spaces.
Errors, token estimates, and target-write reports use stderr.

### Bulk read

Pass the question and each source file:

```bash
plugins/shunt/scripts/bulk-read.sh \
  --question "Which methods call the database?" \
  --paths src/Service.java src/Handler.java
```

Each call is independent. For a follow-up question, pass the source files again. They go to Pi again and can incur provider charges.

Use focused reads to check exact values and line numbers before editing code.

### Code generation

Pass the source and a pattern file when both affect the result. At least one reference file is required.

```bash
plugins/shunt/scripts/code-write.sh \
  --spec "Write tests for UserService. Match the OrderTest conventions." \
  --reference src/UserService.java tests/OrderTest.java \
  --target tests/UserTest.java
```

To update a generated file, include it as a reference. The reference and target can be the same file:

```bash
plugins/shunt/scripts/code-write.sh \
  --spec "Keep the existing tests. Add tests for missing users." \
  --reference src/UserService.java tests/UserTest.java \
  --target tests/UserTest.java
```

Omit `--target` to return code on stdout. Check generated code and run the relevant project checks.

`--target` replaces one complete file. Its parent directory must exist. The script rejects symbolic links.

The worker does not load `AGENTS.md`, `CLAUDE.md`, or `APPEND_SYSTEM.md` automatically. Include relevant constraints in the question or spec. Include source interfaces and pattern files when the worker needs them.

## Hooks

`session-start.sh` adds worker routing at startup, resume, clear, compaction, and fork.
It directs broad analysis and complete-file generation to their skills before content work starts.

`check-file-size.sh` runs before each `Read` call. It blocks full reads of files above `SHUNT_MIN_LINES`, which defaults to 350. It allows reads with an offset or limit, smaller files, and nonexistent files.

`check-bash-read.sh` runs before each `Bash` call. It checks simple reads with `cat`, `head`, `tail`, `less`, and `more`. It allows commands containing `|` or `>`, and other commands. Its inherited parser can block `head -5` on a large file. Use `Read` with an offset or limit for focused reads. The hook does not enforce every possible shell read.

Use bulk reading for summaries and questions across large files. Keep design decisions, debugging, and exact edits with the parent agent. Use focused reads when it needs exact source text.

The session hook and code-writer skill direct complete-file generation to Pi.
No `PreToolUse` hook enforces code generation delegation.

## Configuration

Edit [`.pi/settings.json`](.pi/settings.json) in the loaded plugin directory to control Pi. Both workers read this file on each call.
When you use `--plugin-dir`, this is `plugins/shunt/.pi/settings.json` in your clone.
Marketplace installs use a cached plugin copy. Changes in your clone do not change that installed copy.
Use the environment overrides below for temporary changes to an installed plugin.

The initial settings are:

```json
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.6-terra",
  "defaultThinkingLevel": "high",
  "enabledModels": [],
  "packages": []
}
```

Change `defaultProvider`, `defaultModel`, or `defaultThinkingLevel` to select your worker model and thinking level. The empty `enabledModels` list clears any global model cycle. No plugin-specific packages are configured. Pi can still resolve packages from your global settings.

You can add native Pi project settings such as `retry` and `compaction`. See the [Pi settings reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md) for supported fields. Some fields, such as `httpProxy`, apply only to global settings. Shunt's fixed command flags keep tools, extensions, and sessions disabled.

Only the Pi child process runs from the plugin directory. Pi reads the plugin's `.pi/settings.json` and merges it over your global settings. Source and target paths still refer to the caller's project. Your existing global Pi login and custom model definitions remain available. A missing or invalid plugin settings file stops the call before Pi starts.

For temporary overrides, set these environment variables in your shell or the `env` block of `.claude/settings.json`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PI_BIN` | `pi` | Pi executable name or path. Do not include command arguments. |
| `SHUNT_PI_PROVIDER` | Plugin Pi settings | Provider for both workers. |
| `SHUNT_PI_MODEL` | Plugin Pi settings | Model for both workers. |
| `SHUNT_PI_THINKING` | Plugin Pi settings | Thinking level for both workers. |
| `SHUNT_BULK_READER_PROVIDER` | Common setting | Provider for the bulk reader. |
| `SHUNT_BULK_READER_MODEL` | Common setting | Model for the bulk reader. |
| `SHUNT_BULK_READER_THINKING` | Common setting | Thinking level for the bulk reader. |
| `SHUNT_CODE_WRITER_PROVIDER` | Common setting | Provider for the code writer. |
| `SHUNT_CODE_WRITER_MODEL` | Common setting | Model for the code writer. |
| `SHUNT_CODE_WRITER_THINKING` | Common setting | Thinking level for the code writer. |
| `SHUNT_MIN_LINES` | `350` | File size above which hooks block full reads. |
| `SHUNT_MAX_PAYLOAD_BYTES` | `400000` | Maximum prompt size in bytes, on all operating systems. |
| `SHUNT_TIMEOUT_SECONDS` | `180` | Maximum time for one Pi process. |

A worker environment variable overrides the common environment variable. Both override the corresponding file setting through Pi command flags. Without an environment override, Pi uses the plugin settings over global defaults. Select providers and models that are available in your Pi setup.

The payload limit controls request size. Prompts travel through stdin, so the limit does not depend on `ARG_MAX`. Split large requests or change the limit. For long generations, increase the timeout or split the spec.

## Plugin structure

```text
shunt/
├── .claude-plugin/plugin.json
├── .pi/settings.json
├── hooks/
│   ├── hooks.json
│   ├── session-start.sh
│   ├── check-file-size.sh
│   └── check-bash-read.sh
├── scripts/
│   ├── lib/pi.sh
│   ├── bulk-read.sh
│   └── code-write.sh
├── skills/
│   ├── bulk-reader/SKILL.md
│   └── code-writer/SKILL.md
├── evals/
│   ├── run.sh
│   ├── transport-evals.sh
│   ├── real-world.mjs
│   ├── grade-pg-tests.mjs
│   ├── evals.json
│   └── benchmark.sh
├── LICENSE
└── NOTICE
```

## Checks

Run the hook and transport checks from the repository root. These checks do not call a provider:

```bash
bash plugins/shunt/evals/run.sh
```

Run the real-world cases against a local Pastorix backend checkout with installed dependencies:

```bash
node plugins/shunt/evals/real-world.mjs \
  --repo /path/to/pastorix-backend \
  --case generate-tests
```

These cases require Node.js, an authenticated Claude CLI, and an authenticated Pi CLI.
They use live models. The runner copies selected source files into a temporary workspace and saves its output there.
It copies the plugin for the run and records source hashes, Pi settings, Claude usage, and the model trace.
The source checkout stays outside the evaluation workspace. Its installed dependencies supply Jest and TypeScript.

| Case | Check |
| --- | --- |
| `bulk-cross-file` | Ground the error-handling report in the helper and its real callers. |
| `generate-tests` | Generate passing tests that detect six deliberate faults. |
| `follow-up` | Extend the same test file and keep its existing test block. |
| `missing-context` | Identify missing deployment and schema evidence without inventing values. |
| `comparison-transfer` | Preserve comparison operands when explaining identifier checks in real callers. |

Omit `--case` to run all five cases. Use `--plugin` to test a candidate plugin and `--out` to select a new output directory.
Each case has a 300-second parent timeout and a USD 1.50 Claude budget by default.
Set `--timeout-seconds` or `--budget-usd` to change these limits. The Claude budget does not include Pi calls.

The test grader requires passing TypeScript checks, active assertions, and six faults caught through failed assertions.
Compilation failures and runtime errors do not count as caught faults.
The runner marks successful live cases as `review_required`.
An independent reviewer must check the saved answer and trace against `evals/evals.json`.
The test grader records its result separately. Passing generated tests alone do not prove correct delegation or parent review.
These focused checks do not replace the backend's full repository checks.

For an improvement loop, keep source hashes and model settings the same between baseline and candidate runs.
Change one skill or prompt mechanism supported by a recorded failure. Repeat the affected case, then run the reserved cases.
Keep a candidate only when outcomes improve and the offline checks still pass. Stop when no useful correction is supported.
Keep source copies, traces, and raw results outside this repository.

See the [live evaluation record](evals/results-2026-09-11.md) for measured changes, earlier failures, and follow-up checks.

To run benchmarks with your configured Pi model:

```bash
bash plugins/shunt/evals/run.sh --benchmark
```

Benchmarks make live provider calls. They report parent context estimates and stop if a worker fails. They do not measure total token use or billing savings.

## License

Apache-2.0. This version adapts Spotify Shunt. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the source and changes.
