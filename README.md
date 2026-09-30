# Ez Slack

A private Slack channel plugin for an existing Ez agent. Install one Slack app
per independent agent; invite its bot into several dedicated channels. Each
workspace/channel pair uses an Ez private scope with its own native session and
model/effort. Channels of one agent share its filesystem and tools. Separate
agents require separate Ez installations, plugin volumes and Slack apps.

Slack Socket Mode is the provider connection. The plugin calls the standard
Ez application-channel API; it does not run models, rebuild prompts, save native
history, continue tasks or own an execution queue. It polls core run receipts only
to render replies. Provider reconnect is handled by Slack’s official SDK.

## Requirements and installation

Node 22+, Docker, Ez core with private scope controls (published beta.42 client;
per-conversation model continuity fixes must be installed on the agent), an
authorized owner, and a Slack workspace where you can install custom apps.
This plugin is local/private and not published or catalog-listed.

Build from reviewed source in this repository:

```sh
pnpm install --frozen-lockfile
pnpm verify
npm run release:check
ez plugins inspect slack --source /absolute/ez-slack
ez plugins install slack --source /absolute/ez-slack --revision sha256:INSPECTED_HASH
ez plugins start slack
ez slack health
```

An installation operator registers a private application binding through the
existing `ezenciel-agents-application` CLI without `--share-owner`. Its private
token and relay base URL go to `ez slack configure` as JSON stdin, never command
arguments. Example schema (placeholders, not usable credentials):

```json
{"url":"http://relay:8787","token":"PRIVATE_APPLICATION_TOKEN","privateHttp":true}
```

The relay listener and plugin must share an operator-approved private network.
Follow core’s application-channel and host-owned plugin-network documentation:
pin the inspected plugin revision in the agent’s host-executor network binding.
The plugin cannot grant itself a network, enable the relay listener, pair an
owner or bypass core authority. Use HTTPS outside a trusted private network.

## Slack onboarding

```sh
ez tools serve 18878:8788 slack setup --team T_WORKSPACE_ID --name ANNIe
```

Open `http://127.0.0.1:18878`. The local form links the prepared app manifest.
Create an app from that manifest in the chosen workspace, install it, generate
an app-level token with `connections:write`, and enter the App ID plus bot/app
tokens in the password fields. The server verifies the bot’s workspace/user and
app-token validity; Socket events must also match the configured app/workspace.
Tokens are stored mode 0600 in the private plugin volume and never returned.
The setup form requires same-origin requests and a per-process CSRF token.
Stop the temporary setup command after onboarding.

```sh
ez plugins stop slack
ez plugins start slack
ez slack doctor --json
```

Invite the bot to an explicitly intended channel and send a human text message.
The bot processes human messages from public/private channels to which it is
invited. All human members there act with this agent’s owner authority: use
dedicated trusted channels. Bot messages, edits, message subtypes, DMs and other
workspaces/apps are ignored. Thread messages share the channel’s conversation;
replies go to the channel, not an independent thread session.

## Channel controls

```text
!ez help
!ez ai
!ez select PRESET_ID
!ez model CLI MODEL EFFORT
!ez new
!ez stop
```

`!ez ai` reads core’s installed catalog and this channel’s selection. Use those
exact choices. Controls use core’s optimistic expected-session check and canonical
readback. A model change follows core/native continuity semantics; a different
engine/provider may start a fresh session. `!ez new` resets only this channel to
the default AI. `!ez stop` cancels this adapter’s known pending runs in this channel.
It does not remove schedules or cancel unrelated owner work.

Read the same canonical settings through the installed plugin:

```sh
ez slack settings --channel C_CHANNEL_ID
ez slack receipts
ez slack receipts --key T_WORKSPACE_ID:Ev_EVENT_ID
```

Exit codes: 0 success, 1 invalid/unavailable operation, 2 doctor not connected.
`health` proves service availability, not Slack/native delivery. `doctor` is
read-only and verifies the Slack identity and current Ez registration. Completion
requires real inbound admission, native reply, matching channel plus Slack `ts`
receipt. Slack acceptance does not prove a person read the message.

## State, recovery and limits

The private `data` volume holds `connection.json`, `slack.json`, transport
`receipts.json` and the service socket. Receipts contain inbound hashes, core
request/run pointers and provider send IDs/hashes; no transcripts or persisted
engine run statuses. Retain at most 1000 receipts, evicting confirmed closed
records first. Capacity blocks new admission if only unresolved records remain.
Do not reuse old Slack event IDs after bounded receipt retention.

Slack replay within retained receipts does not start another turn. Restart resumes
read/render for known core run pointers only; never resubmits an uncertain inbound
admission or external send. A core restart loses in-flight run/inbox state by
design. Native sessions/settings remain in core; stranded transport records need
operator investigation, not an automated turn replay. `receipts` identifies
uncertainty; reconnect/start does not prove recovery. No blind provider retries.

v1 supports text and channel controls. No attachments, reactions, approval buttons,
DMs, agent-to-agent channels or automatic schedule-result discovery. A pending
core approval is reported without inferring consent; cancel and use an existing
supported owner surface when necessary. Slack app-token reconnects cannot be used
for Slack Marketplace distribution; use this private installation path.

Stop with `ez plugins stop slack`. Uninstall with `ez plugins uninstall slack`;
the manager preserves the private volume. Back it up as sensitive data through
operator Docker volume tools. Reinstall the same reviewed source to restore it;
rotate tokens in the same Slack app and resubmit the local form, then restart.
To revoke completely, revoke the core application binding and uninstall the Slack
app in Slack. Changing workspace/app identity needs a separate installation.

## Development

```sh
pnpm verify
npm run release:check
pnpm smoke:docker
```

Docker smoke installs through the real Ez manager, exercises registered CLI,
restart/crash recovery, setup routing and data-preserving uninstall. Synthetic
provider tests exercise scoped routing, canonical AI controls, streaming delivery,
deduplication and uncertainty. They are not live Slack acceptance. Run one real
native channel exchange after credentials are supplied, then a two-channel marker
and model/effort check across restart. See CONTRIBUTING.md and SECURITY.md.
