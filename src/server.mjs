import http from 'node:http';
import { mkdir, chmod, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SocketModeClient } from '@slack/socket-mode';
import { applicationCall } from '@jc_stack/ez-agents/application-client';
import { connection, slackConfig } from './config.mjs';
import { Slack } from './slack.mjs';
import { Receipts } from './storage.mjs';
import { Channel, scopeFor, validThreadTs } from './channel.mjs';
import { jsonBody, rpc } from './ipc.mjs';

export async function serve(directory, { createSocket = options => new SocketModeClient(options) } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Managed deployment owns one provider service. Refuse a live socket;
  // recover a stale socket after a crashed container without a persistent PID lock.
  try { await rpc(directory, 'health'); throw Error('Slack service already running'); }
  catch (e) { if (!['ENOENT', 'ECONNREFUSED'].includes(e.code)) throw e; }
  const socketPath = join(directory, 'slack.sock');
  let socket, channel, identity, bound, connected = false, issue = null;
  const receipts = new Receipts(directory);
  const logger = { debug() {}, info() {}, warn() {}, error() {}, getLevel() { return 'error'; }, setLevel() {}, setName() {} };
  try {
    await unlink(socketPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
    try {
      bound = await connection(directory); identity = await slackConfig(directory);
      await applicationCall('/v1/registration', undefined, bound);
      const slack = new Slack(identity.botToken);
      const who = await slack.call('auth.test');
      if (who.team_id !== identity.teamId || who.user_id !== identity.botUserId || !who.bot_id) throw Error('Slack identity changed');
      channel = new Channel({ identity, connection: bound, receipts, slack });
      socket = createSocket({ appToken: identity.appToken, logger, clientOptions: { logger, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true } });
      socket.on('connected', () => { connected = true; issue = null; });
      socket.on('disconnected', () => { connected = false; });
      socket.on('error', () => { issue = 'socket_unavailable'; connected = false; });
      socket.on('slack_event', ({ body, ack, type }) => {
        const work = type === 'slash_commands' ? channel.receiveSlash(body, ack) : channel.receive(body, ack);
        void work.catch(() => { issue = 'channel_operation_failed'; });
      });
      await socket.start();
      await channel.resumeDelivery();
    } catch (e) { issue = e.code === 'ENOENT' ? 'setup_required' : 'connection_unavailable'; }
    const server = http.createServer(async (req, res) => {
      const respond = (status, value) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(value)); };
      try {
        if (req.method !== 'POST' || req.url !== '/') throw Error('Unknown operation');
        const { command, args = {} } = await jsonBody(req);
        let data;
        if (command === 'health') data = { healthy: true, configured: Boolean(identity), connected, issue };
        else if (command === 'doctor') {
          if (Object.keys(args).some(k => k !== 'channel') || (args.channel !== undefined && !/^[CG][A-Z0-9]{5,40}$/.test(args.channel))) throw Error('Invalid doctor channel');
          const c = await connection(directory), s = await slackConfig(directory);
          const registration = await applicationCall('/v1/registration', undefined, c);
          const provider = new Slack(s.botToken), who = await provider.call('auth.test');
          if (who.team_id !== s.teamId || who.user_id !== s.botUserId) throw Error('Slack identity changed');
          data = { configured: true, connected, issue, teamId: s.teamId, appId: s.appId, botUserId: s.botUserId, bindingId: registration.bindingId, ownerId: registration.ownerId,
            receiptCount: (await receipts.load()).length, watching: channel?.watching.size ?? 0 };
          if (args.channel !== undefined) {
            try { data.channelAccess = {channel:args.channel,botMember:await provider.channelMember(args.channel,s.botUserId,s.botUserId)}; }
            catch (e) { data.channelAccess = {channel:args.channel,botMember:null,issue:/^[a-z_]{1,80}$/.test(e.providerCode ?? '') ? e.providerCode : 'membership_unavailable'}; }
          }
        } else if (command === 'receipts') {
          if (Object.keys(args).some(k => k !== 'key') || (args.key !== undefined && (typeof args.key !== 'string' || args.key.length > 100))) throw Error('Invalid receipt key');
          const rows = await receipts.load(); data = args.key ? rows.find(r => r.key === args.key) ?? null : rows.slice(-20);
        } else if (command === 'settings') {
          if (!identity || !bound || !/^[CG][A-Z0-9]{5,40}$/.test(args.channel ?? '') ||
            (args.threadTs !== undefined && !validThreadTs(args.threadTs)) || Object.keys(args).some(k => !['channel','threadTs'].includes(k))) throw Error('Supply a Slack channel ID and optional root thread timestamp');
          data = await applicationCall(`/v1/scope-control?scope=${encodeURIComponent(scopeFor(identity.teamId, args.channel, args.threadTs))}`, undefined, bound);
        } else throw Error('Unknown operation');
        respond(200, {ok: true, data});
      } catch { respond(400, {ok: false, error: 'Slack operation unavailable; check configuration and bound identity'}); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    return { server, async close() { channel?.close(); await socket?.disconnect().catch(() => {}); await new Promise(resolve => server.close(resolve)); await unlink(socketPath).catch(() => {}); } };
  } catch (e) { channel?.close(); await socket?.disconnect().catch(() => {}); throw e; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.env.EZ_SLACK_STATE ?? '/state');
  const service = await serve(directory);
  console.log(JSON.stringify({ready: true}));
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { if (stopping) return; stopping = true; await service.close(); process.exit(); });
}
