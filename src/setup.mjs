import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { saveSlack, connection } from './config.mjs';
import { Slack } from './slack.mjs';
import { applicationCall } from '@jc_stack/ez-agents/application-client';

export async function setup(directory, { port = 8788, teamId = '', name = 'Ez Agent', slack = new Slack(), coreCall = applicationCall } = {}) {
  if (!/^T[A-Z0-9]{5,40}$/.test(teamId) || !/^[A-Za-z0-9 _-]{1,40}$/.test(name)) throw Error('Supply --team WORKSPACE_ID and --name BOT_NAME');
  await coreCall('/v1/registration', undefined, await connection(directory));
  const csrf = randomBytes(32).toString('hex');
  const page = await readFile(new URL('../web/setup.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../slack-app-manifest.json', import.meta.url), 'utf8'));
  manifest.display_information.name = name; manifest.features.bot_user.display_name = name;
  const server = http.createServer(async (req, res) => {
    const send = (status, type, body) => { res.writeHead(status, {'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer'}); res.end(body); };
    if (!/^(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(req.headers.host ?? '')) return send(403, 'text/plain', 'Local setup only');
    if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', page.replaceAll('{{CSRF}}', csrf).replaceAll('{{TEAM}}', teamId).replaceAll('{{NAME}}', name));
    if (req.method === 'GET' && req.url === '/manifest') return send(200, 'application/json', JSON.stringify(manifest, null, 2));
    if (req.method !== 'POST' || req.url !== '/configure' || req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/x-www-form-urlencoded') return send(403, 'text/plain', 'Invalid setup request');
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 4096) throw Error('Setup input too large'); chunks.push(chunk); }
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      if ([...form.keys()].length !== 4 || !['csrf','appId','appToken','botToken'].every(k => form.getAll(k).length === 1)) throw Error('Invalid setup fields');
      const supplied = Buffer.from(form.get('csrf') ?? '');
      if (supplied.length !== csrf.length || !timingSafeEqual(supplied, Buffer.from(csrf))) throw Error('Invalid setup form');
      const input = { teamId, appId: form.get('appId'), appToken: form.get('appToken'), botToken: form.get('botToken') };
      await saveSlack(directory, input, slack);
      send(200, 'text/html', '<!doctype html><title>Slack credentials saved</title><h1>Credentials saved</h1><p>Restart the Slack plugin, invite the bot to your channel, then send a message. Credentials were stored privately and are never returned by this page.</p>');
    } catch { send(400, 'text/plain', 'Setup was not completed. Check the app ID, both tokens, workspace and Ez connection. Credentials are never echoed.'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  return server;
}
