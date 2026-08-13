import {
  DEFAULT_DOCTOR_TIMEOUT_MS,
  MAX_DOCTOR_TIMEOUT_MS,
} from "./cli-doctor-options.js";
import {
  DEFAULT_SETUP_TIMEOUT_MS,
  MAX_SETUP_TIMEOUT_MS,
} from "./cli-setup-options.js";
import { MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from "./cli-option-values.js";

export const CLI_VERSION = "0.1.0";

export const CLI_HELP = `Napier CLI ${CLI_VERSION}

Usage:
  napier run --workspace <path> --prompt <text> [options]
  napier browser-task --workspace <path> --backend <browser_use_local|browser_use_cloud> --task <text> [options]
  napier chat --workspace <path> [options]
  napier tui --workspace <path> [options]
  napier capabilities --workspace <path> [options]
  napier doctor --workspace <path> [options]
  napier setup --workspace <path> [options]
  napier resume --workspace <path> --thread <thread-id> [options]
  napier branch --workspace <path> --thread <thread-id> --from-seq <n> [options]
  napier experiment --workspace <path> --thread <thread-id> --run <run-id> --message-seq <n> [options]
  napier model-experiment --workspace <path> --thread <thread-id> --run <run-id> --turn-index <n> [options]
  napier tool-experiment --workspace <path> --thread <thread-id> --run <run-id> --call-id <id> [options]
  napier rpc --workspace <path> [options]
  napier workflow --workspace <path> --manifest <path> [options]

Commands:
  run                    Start a new Run on a new or existing Thread
  browser-task           Run an explicit autonomous task with Browser Use local or Cloud
  chat                   Open a multi-turn interactive Agent session
  tui                    Open the full-screen local Agent terminal
  capabilities           Inspect, preview, or apply an Agent capability preset
  doctor                 Diagnose first-use model, network, Browser, and Sandbox readiness
  setup                  Configure a Provider, pinned Browser, or Sandbox runtime
  resume                 Continue an interrupted Run as a linked child
  branch                 Fork message history at an exact Ledger sequence
  experiment             Re-run a historical Agent message read-only
  model-experiment       Re-run one captured provider call without tools
  tool-experiment        Re-run one captured built-in read-only tool call
  rpc                    Serve local JSON-RPC 2.0 over stdio
  workflow               Execute or resume a typed Plan/Blueprint Workflow

Workspace options:
  --data-root <path>     Napier state directory (default: <workspace>/.napier)
  --jsonl                Emit StreamFrame or Doctor JSON objects on stdout

Run and resume options:
  --model <provider/id>  Model for this Run
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

Doctor options:
  --model <provider/id>  Optional model catalog and credential readiness check
  --credential-env <var> Check this environment variable without printing its value
  --browser-backend <id> Check native_playwright (default), browser_use_local, or browser_use_cloud readiness
  --offline              Skip public Search, Fetch, and Browser probes
  --timeout-ms <ms>      Total Doctor time budget (default ${DEFAULT_DOCTOR_TIMEOUT_MS}, max ${MAX_DOCTOR_TIMEOUT_MS})

Setup options:
  --component <name>     browser, browser-use-local, or sandbox runtime
  --provider <id>        Standard Provider selected from setup preview
  --expected-preview     Exact setup preview SHA-256 required for apply
  --timeout-ms <ms>      Component install/verification budget (default ${DEFAULT_SETUP_TIMEOUT_MS}, max ${MAX_SETUP_TIMEOUT_MS})
  --apply                Apply the exact Provider, Browser, or Sandbox preview
  --uninstall            Preview/remove the persisted Sandbox binding; retain image
  --jsonl                Emit one setup preview or result JSON object

Capability options:
  --agent <agent-id>     Agent profile (default: first local Agent)
  --preset <id>          coding, research, data, browser, or safe_automation
  --upgrade-recommended  Preview a safe contract upgrade; preserve overrides
  --restore-recommended  Preview the versioned default recommendation
  --expected-revision    Exact Agent revision required for upgrade/restore
  --diff-sha256 <hash>   Exact upgrade/restore preview hash required for apply
  --apply                Persist the selected preset as a new Agent revision
  --jsonl                Emit one typed capability-status JSON object

Chat options:
  --agent <agent-id>     Agent for the first new Thread
  --thread <thread-id>   Continue this existing Thread
  --title <text>         Title for the first new Thread
  --preset <id>          Temporary preset for each new Run; Agent stays unchanged
  --model <provider/id>  Initial model; --credential-env <var> bootstraps it

TUI options:
  Same as chat; requires interactive stdin/stdout TTYs with raw mode

Run options:
  --prompt <text>        User prompt for the Run
  --credential-env <var> Register/reuse this model credential environment name
  --agent <agent-id>     Agent for a new Thread
  --thread <thread-id>   Append to an existing Thread
  --source-run <run-id>  Explicit completed same-Thread Run for private Source continuity
  --title <text>         Title for a new Thread
  --preset <id>          Temporary capability preset for this Run only
                         Safe Automation Browser actions require TTY approve/reject

Browser task options:
  --backend <id>         Explicitly select browser_use_local or browser_use_cloud; native remains default elsewhere
  --task <text>          Autonomous public-web task (1-8000 characters)
  --start-url <url>      Deterministic first page (required for Cloud); must match the domain allowlist
  --model <provider/id>  Explicit second model (OpenAI, Anthropic, Google, Browser Use, DeepSeek, or OpenRouter)
  --credential-env <var> Optional environment override; otherwise use the active stored reference
  --allowed-domains <d>  Required comma-separated public host allowlist
                         First slice is read-only: no typing, upload, download, script, or file actions
  --max-steps <n>        Browser Use step budget (default 25, max 100)
  --max-cost-usd <usd>   Required Cloud ceiling (0.01-100); Napier stops on polled provider cost
                         Cloud sends task/URL/domains/page data/screenshots; no workspace files; provider-plan retention
                         Local opens a visible fresh-profile browser; type pause, takeover, resume, or stop + Enter
  --timeout-ms <ms>      Wall-time limit; Ctrl+C stops the selected backend and local browser process group

Resume options:
  --thread <thread-id>   Waiting Thread containing an interrupted Run
  --run <run-id>         Specific interrupted Run (default: latest)

Branch options:
  --thread <thread-id>   Source Thread
  --from-seq <n>         Existing source Ledger sequence
  --title <text>         Optional branch title

Agent experiment options:
  --thread <thread-id>   Source Agent Thread
  --run <run-id>         Terminal source user Run
  --message-seq <n>      Exact source message Ledger sequence
  --model <provider/id>  Optional candidate model
  --title <text>         Optional isolated target title
  --tool-results <mode>  live (default) or reuse-source
  --preview              Preview frozen inputs without mutation
  --expected-preview     Required preview SHA-256 for execution
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

Model invocation experiment options:
  --thread <thread-id>   Source Agent Thread
  --run <run-id>         Terminal source Run with a local call capsule
  --turn-index <n>       Zero-based source model context turn
  --model <provider/id>  Optional candidate provider-backed model
  --title <text>         Optional isolated target title
  --preview              Preview frozen provider context without mutation
  --expected-preview     Required preview SHA-256 for execution
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

Tool invocation experiment options:
  --thread <thread-id>   Source Agent Thread
  --run <run-id>         Terminal source Run with a local tool capsule
  --call-id <id>         Exact source tool call ID
  --title <text>         Optional isolated target title
  --preview              Preview frozen arguments and current scope
  --expected-preview     Required preview SHA-256 for execution
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})

RPC options:
  --workspace <path>     Workspace served by the long-lived Runtime
  --data-root <path>     Napier state directory (default: <workspace>/.napier)

Workflow options:
  --manifest <path>      Workspace-relative Workflow manifest JSON
  --input-json <json>    Typed input for a new Workflow
  --thread <thread-id>   Existing target Thread
  --agent <agent-id>     Agent for a new target Thread
  --title <text>         Title for a new target Thread
  --plan <plan-id>       Resume an existing Workflow Plan
  --retry-blocked        Explicitly reopen retryable blocked nodes
  --break-before <ids>   Pause before comma-separated node IDs
  --continue-breakpoint  Explicitly continue the open Workflow breakpoint
  --approve              Approve the open Workflow Approval node, then resume
  --reject               Reject the open Workflow Approval node, then resume
  --decision-note <text> Optional answer note used with --approve/--reject
  --from-node <node-id>  Fork an experiment from this Workflow node
  --single-node          Execute selected checkpoint; hold direct successors
  --step-nodes           Execute one node, then step through the rerun subgraph
  --simulate-output-json Simulate checkpoint output, then execute descendants
  --replace-input-json  Replace checkpoint input, then execute its subgraph
  --replace-workflow-input-json Replace top-level input and rerun the Workflow
  --model-overrides-json Per-node ModelRef overrides for rerun nodes
  --preview-experiment   Preview a checkpoint experiment without mutation
  --confirm-side-effects Confirm the exact current side-effect preview
  --expected-preview     SHA-256 returned by experiment preview

Other:
  -h, --help             Show help
  -v, --version          Show version
`;
