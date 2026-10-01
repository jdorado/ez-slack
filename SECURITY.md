# Security

Report credential exposure or authority defects privately to the maintainer via
the repository’s security reporting feature; never post tokens or conversations
in public issues. Supported code is the latest reviewed private source revision.

Slack bot/app credentials and the Ez application bearer live only in the private
plugin volume. The plugin never prints them, exports them or mounts its secrets
into the agent. Configure them through the loopback setup form or private operator
stdin. The form restricts host/origin, bounds input, requires CSRF and sends no
third-party assets. Do not publicly proxy the setup service.

An invited trusted channel grants all its human participants this agent’s owner
tool authority. v1 is not an ACL/tenant sandbox. Independent agents have separate
installations and Slack apps. Core checks the application binding on every call.
Provider workspace/app/bot identity is pinned; bot messages/subtypes are ignored.
No provider content can change authentication, network attachment or core owner.

Uncertain sends remain unresolved and are never automatically resent. Private
state survives uninstall, so revoke both the core binding and Slack app to remove
provider access. Treat backups as credential material.
