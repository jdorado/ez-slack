# Ez Slack

A Slack channel plugin for an existing Ez agent. Install one Slack app
per independent agent; invite its bot into several dedicated channels. Each
workspace/channel pair and each thread use distinct Ez private scopes with their
own native sessions and model/effort. Channels and threads of one agent share
its filesystem and tools. Separate
agents require separate Ez installations, plugin volumes and Slack apps.

Slack Socket Mode is the provider connection. The plugin calls the standard
Ez application-channel API; it does not run models, rebuild prompts, save native
history, continue tasks or own an execution queue. It polls core run receipts only
to render replies. Provider reconnect is handled by Slack’s official SDK.

## Requirements and installation

Node 22+, Docker, Ez core with private scope controls (published beta.42 client;
per-conversation model continuity fixes must be installed on the agent), an
authorized owner, and a Slack workspace where you can install custom apps.
The source and beta package are public. Slack Marketplace distribution and core
catalog listing are separate from this npm release.

The installation operator downloads the exact package with
`npm pack @jc_stack/ez-slack@0.1.0-beta.1 --ignore-scripts`, verifies its registry
digest, and extracts it into a private versioned package directory. Inspect and
install that directory through the owning agent's bound launcher from its workspace.
A reviewed source commit is also supported; keep one canonical checkout.
Developer checks run in the source checkout:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm run release:check
ez plugins inspect slack --source /absolute/ez-slack
ez plugins install slack --source /absolute/ez-slack --revision sha256:INSPECTED_HASH
ez plugins start slack
ez slack health
```

For an existing released installation, preserve its Slack app, core binding and
private volume. Use `ez updates prepare slack --version RELEASE_VERSION`, review
the returned artifact identity, then `ez updates apply JOB_ID`. The installed
updater drains active work before replacement. An operator must authorize the
inspected revision in the existing private-network binding before activation.

A private `beta.1.rc.N` sorts after the public `beta.1` in SemVer, so the updater
cannot perform this first promotion. The installation operator backs up private
state and records the existing private-network bindings, waits for active work to
drain, then uses the supported data-preserving source-install cycle:

```sh
ez plugins uninstall slack
ez plugins inspect slack --source /absolute/reviewed-package
ez plugins install slack --source /absolute/reviewed-package --revision sha256:INSPECTED_HASH
ez plugins start slack
ez slack doctor --json
```

Keep the same agent tools home and Slack app. The manager retains the private
volume; the operator preserves its approved network route and authorizes the new
inspected revision before activation. No credential setup or re-pairing is needed.
Verify the identity, retained settings/receipts and a native reply after promotion.

Fresh-account clean-host onboarding and reboot acceptance remain beta limitations;
existing-account native replies and provider receipts are required for rollout.

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
ez tools serve 18878:8788 slack setup --team T_WORKSPACE_ID --name annie
```

Open `http://127.0.0.1:18878`. The local form links the generated app manifest,
including native controls and their permissions by default. One plugin-owned
command list generates registration hints and help; there is no per-channel
command setup. The app name determines its native command (`annie` → `/ez-annie`).
Create an app from that manifest in the chosen workspace, install it, generate
an app-level token with `connections:write`, and enter the App ID plus bot/app
tokens in the password fields. The server verifies the bot’s workspace/user and
app-token validity; Socket events must also match the configured app/workspace.
An installation operator can instead pass the same credentials privately to
`ez slack configure-slack` as JSON stdin (`teamId`, `appId`, `botToken`,
`appToken`). Both paths verify the live identity and refuse replacing a profile
with a different workspace/app. Never put token values in command arguments.

Tokens are stored mode 0600 in the private plugin volume and never returned.
The setup form requires same-origin requests and a per-process CSRF token.
Stop the temporary setup command after onboarding.

`ez slack manifest --name NAME` returns the same generated manifest without
credentials or a running setup server. To upgrade an existing Slack app, update
its manifest with the generated controls/scopes and reinstall when Slack requests
new permissions. Linking new apps from this manifest includes them immediately.

```sh
ez plugins stop slack
ez plugins start slack
ez slack doctor --json
```

Invite the bot to an explicitly intended channel and send a human text message.
The bot processes human messages from public/private channels to which it is
invited. All human members there act with this agent’s owner authority: use
dedicated trusted channels. Bot messages, edits, message subtypes, DMs and other
workspaces/apps are ignored. Ordinary channel messages continue the channel’s
conversation. A thread uses its parent message’s `thread_ts` as its separate
scope: replies in that thread continue the same native session and are delivered
back into that thread. Different threads never share conversation history. Core
still owns execution serialization and workspace authority; separate sessions
do not create parallel writers. Thread sessions begin with the first received
thread message; the plugin does not copy the channel transcript into them.

`!ez status` shows the running Slack transport version plus the runtime/version
summary shared with Telegram when the installed Ez supports it. Older Ez
versions are explicitly reported as unavailable, never inferred from plugin
dependencies.

## Channel controls

Use these four controls in the channel:

```text
!ez ai
!ez ai list
!ez ai codex gpt-6.1-sol low
!ez ai effort high
```

`!ez ai` shows only this channel's current CLI, model and effort. `!ez ai list`
shows the installed catalog; choose exact CLI/model/effort values from it. Use `CLI@PROFILE` for a named login (for example, `!ez ai claude@work sonnet high`); plain `claude` selects the default login.
`!ez ai CLI MODEL [EFFORT]` applies the selection through core and confirms its
canonical readback. `!ez ai effort EFFORT` preserves the current CLI, login, provider and
model and changes only its effort. Unsupported choices return usage guidance
without changing settings or starting an agent turn.

A new channel inherits the agent's selected AI when its conversation begins,
then keeps its own selection. Changing one channel does not change Telegram or
other channels. The same commands posted inside a thread apply only to that
thread. Same-client/provider changes follow core/native conversation continuity;
a different client/provider may start a fresh session.

The generated slash command accepts the same arguments: for example
`/ez-annie ai`, `/ez-annie ai list` or `/ez-annie ai codex gpt-6.1-sol low`.
The bot and caller must both belong to the channel. Slack routes duplicate slash
names to the most recently installed app, so setup derives a distinct command
from each app name. Existing Slack apps require the generated manifest's command
and scopes to be installed. Message controls work without slash registration.
Custom slash commands cannot run inside threads; use `!ez ai` there.

Primary help focuses on AI selection. Earlier `model`, `select`, `status`, `new`
and `stop` controls remain accepted for compatibility; Telegram remains the main
surface for broader management. Controls use core's expected-session check and
canonical readback. Uncertain operations are never replayed.

Read the same canonical settings through the installed plugin:

```sh
ez slack settings --channel C_CHANNEL_ID
ez slack doctor --json --channel C_CHANNEL_ID
ez slack settings --channel C_CHANNEL_ID --thread PARENT_MESSAGE_TS
ez slack receipts
ez slack receipts --key T_WORKSPACE_ID:Ev_EVENT_ID
```

Exit codes: 0 success, 1 invalid/unavailable operation, 2 doctor not connected.
`health` proves service availability, not Slack/native delivery. `doctor` is
read-only and verifies the Slack identity and current Ez registration. Its optional
`--channel` checks the bot against the actual channel member list, reporting a
provider error code if unavailable; exit 2 also covers unconfirmed membership.
Slash admission checks both caller and bot in that list. Completion
requires real inbound admission, native reply, matching channel plus Slack `ts`
receipt. Slack acceptance does not prove a person read the message.

## State, recovery and limits

The private `data` volume holds `connection.json`, `slack.json`, transport
`receipts.json` and the service socket. Receipts contain inbound hashes, core
request/run pointers and provider send IDs/hashes; no transcripts or persisted
engine run statuses. Retain at most 1000 receipts, evicting confirmed closed
records first. Capacity blocks new admission if only unresolved records remain.
Do not reuse old Slack event IDs after bounded receipt retention.
Thread receipts retain the parent timestamp for restart delivery. Existing
pre-upgrade receipts keep their original channel scope and destination; they
are never replayed or moved into a new thread session.

Slack replay within retained receipts does not start another turn. Restart resumes
read/render for known core run pointers only; never resubmits an uncertain inbound
admission or external send. A core restart loses in-flight run/inbox state by
design. Native sessions/settings remain in core; stranded transport records need
operator investigation, not an automated turn replay. `receipts` identifies
uncertainty; reconnect/start does not prove recovery. No blind provider retries.

Supports text, channel controls and one inbound PDF, JPEG/PNG/WebP image, or text/Markdown attachment per message (10 MiB maximum), through core’s shared Telegram/application staging path. Existing Slack apps must add `files:read` and reinstall the app. Remote files and multiple attachments are rejected explicitly. A file caption starting with `!ez` is an ordinary prompt for the agent, not a channel control; send controls as text-only messages. Temporary Slack failures while fetching a file get a "please resend" reply and are recorded as `attachment_unavailable`; an input interrupted mid-download stays visible as `attachment_pending` (unconfirmed) and is not replayed. No outbound attachments, reactions, approval buttons,
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
pnpm run release:check
pnpm smoke:docker
```

Docker smoke installs through the real Ez manager, exercises registered CLI,
restart/crash recovery and data-preserving uninstall. Synthetic
provider tests exercise scoped routing, canonical AI controls, streaming delivery,
deduplication and uncertainty. They are not live Slack acceptance. Run one real
native channel exchange after credentials are supplied, then a two-channel marker
and model/effort check across restart. See CONTRIBUTING.md and SECURITY.md.
