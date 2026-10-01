import { join } from 'node:path';
import { read, atomic } from './storage.mjs';

const id = (v, prefix) => typeof v === 'string' && new RegExp(`^${prefix}[A-Z0-9]{5,40}$`).test(v);
export function validateConnection(c) {
  if (!c || Object.keys(c).some(k => !['url', 'token', 'privateHttp'].includes(k))) throw Error('Invalid Ez connection');
  const u = new URL(c.url);
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash ||
      !(u.protocol === 'https:' || (u.protocol === 'http:' && c.privateHttp === true))) throw Error('Use HTTPS or an explicitly trusted private Ez network');
  if (!/^[A-Za-z0-9_-]{43,200}$/.test(c.token)) throw Error('Invalid Ez credential');
  if (c.privateHttp !== undefined && typeof c.privateHttp !== 'boolean') throw Error('Invalid privateHttp');
  return c;
}
export function validateSlack(c) {
  if (!c || Object.keys(c).some(k => !['appId', 'teamId', 'botToken', 'appToken', 'botUserId'].includes(k)) ||
      !id(c.appId, 'A') || !id(c.teamId, 'T') || !/^xoxb-[A-Za-z0-9-]{10,300}$/.test(c.botToken) ||
      !/^xapp-[A-Za-z0-9-]{10,300}$/.test(c.appToken) || (c.botUserId !== undefined && !id(c.botUserId, '[UW]'))) throw Error('Invalid Slack app credentials or identity');
  return c;
}
export async function connection(directory) { return validateConnection(await read(join(directory, 'connection.json'))); }
export async function saveConnection(directory, c) { await atomic(join(directory, 'connection.json'), validateConnection(c)); }
export async function slackConfig(directory) { return validateSlack(await read(join(directory, 'slack.json'))); }
export async function saveSlack(directory, input, slack) {
  const c = validateSlack(input);
  let old;
  try { old = await slackConfig(directory); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (old && (old.teamId !== c.teamId || old.appId !== c.appId)) throw Error('Existing profile belongs to a different Slack app; use a separate agent');
  const identity = await slack.call('auth.test', {}, c.botToken);
  if (identity.team_id !== c.teamId || !identity.bot_id || !id(identity.user_id, '[UW]')) throw Error('Slack bot belongs to a different workspace or is not a bot');
  // Validate the app-level token without retaining or exposing its temporary WebSocket URL.
  await slack.call('apps.connections.open', {}, c.appToken);
  await atomic(join(directory, 'slack.json'), { ...c, botUserId: identity.user_id });
  return { teamId: c.teamId, appId: c.appId, botUserId: identity.user_id, restartRequired: true };
}
