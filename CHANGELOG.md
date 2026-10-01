# Changelog

## 0.1.0-beta.1

- Connect trusted Slack channels to an existing native Ez agent through Socket Mode and the standard application channel.
- Preserve channel conversations and separate each thread by its parent timestamp; replies and controls stay in their original channel or thread.
- Acknowledge input only after durable admission. Duplicate envelopes remain replayable if the first persistence attempt fails.
- Keep credentials and deterministic transport receipts in private plugin state; preserve uncertain admissions and sends without replay.
- Support per-channel and per-thread native AI controls, read-only identity/receipt checks, and the local credential setup form.

Beta limits: text and channel controls only; no DMs, attachments, reactions, approval buttons or Slack Marketplace distribution. Automated clean installation and existing-account native/provider acceptance are verified. Fresh-account onboarding on a clean host and reboot acceptance remain deferred under the core beta policy; they are required before a stable release.
