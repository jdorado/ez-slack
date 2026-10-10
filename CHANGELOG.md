# Changelog

## 0.1.0-beta.3

- Requires Ez core 0.1.0-beta.50 or newer for the manifest example.
  Older cores refuse the update and retain the installed version.
- Add a representative manifest example for tool discovery.

- Exit configured startup failures so the existing service supervisor can recover, rather than leaving Slack permanently disconnected behind healthy IPC. Report only a fixed startup stage, without provider error details or tokens. Missing initial configuration remains inert for setup.
- Accept one inbound Slack attachment through the shared core staging path, preserving captions and thread scope. Authenticate bounded private downloads; reject unsupported/multiple files without native admission. Add files:read to the setup manifest.
- Download attachments one at a time into a single pre-sized buffer to bound memory. Mark the receipt `attachment_pending` (unconfirmed) before the download and clear it afterwards, so a crash is visible in status/receipts instead of silently dropping the input. Transient failures (HTTP 5xx/429/408, timeouts, network errors) reply "temporary, please resend" and record `attachment_unavailable`; only bad files record `attachment_rejected`.
- A file caption beginning with `!ez` is sent to the agent as an ordinary prompt; it is never executed as a channel control. Send controls as text-only messages.

## 0.1.0-beta.2

- Show the loaded Slack transport revision and Ez runtime/version summary in `!ez status`.

- Simplify channel/thread AI controls to `ai`, `ai list`, `ai CLI MODEL [EFFORT]` and `ai effort EFFORT`. Show concise canonical selections, preserve CLI/model/provider for effort-only changes, and keep new-channel inheritance unchanged. Previous controls remain accepted but are omitted from primary help.

- Include native Slack controls by default in the generated linking manifest, with an app-specific command name derived from its name. One plugin command registry owns setup, registration hints and help; `slack manifest --name NAME` returns the same manifest offline.
- Read channel/thread status from canonical settings, live pending runs and durable transport receipts without creating a native turn.
- Admit native slash controls durably, pin the workspace/app, verify channel membership and deduplicate before deterministic core operations.
- Verify bot and caller against the actual member list using Slack's GET read contract and supported page size, without requiring optional conversation metadata. Diagnose channel access through read-only `doctor --channel` and sanitized provider error codes in receipts.

## 0.1.0-beta.1

- Connect trusted Slack channels to an existing native Ez agent through Socket Mode and the standard application channel.
- Preserve channel conversations and separate each thread by its parent timestamp; replies and controls stay in their original channel or thread.
- Acknowledge input only after durable admission. Duplicate envelopes remain replayable if the first persistence attempt fails.
- Keep credentials and deterministic transport receipts in private plugin state; preserve uncertain admissions and sends without replay.
- Support per-channel and per-thread native AI controls, read-only identity/receipt checks, and the local credential setup form.

Beta limits: text and channel controls only; no DMs, attachments, reactions, approval buttons or Slack Marketplace distribution. Automated clean installation and existing-account native/provider acceptance are verified. Fresh-account onboarding on a clean host and reboot acceptance remain deferred under the core beta policy; they are required before a stable release.
