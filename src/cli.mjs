import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { connection, saveConnection, saveSlack, validateSlack } from './config.mjs';
import { jsonBody, rpc } from './ipc.mjs';
import { setup } from './setup.mjs';
import { Slack } from './slack.mjs';
import { applicationCall } from '@jc_stack/ez-agents/application-client';
import { appManifest } from './commands.mjs';

export async function main() {
  const output = v => process.stdout.write(JSON.stringify(v) + '\n');
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { json: {type:'boolean'}, team: {type:'string'}, name: {type:'string'}, channel: {type:'string'}, thread: {type:'string'}, key: {type:'string'}, port: {type:'string'}, help: {type:'boolean'}, version: {type:'boolean'} } });
    const [command] = positionals;
    if (positionals.length > 1) throw Error('Unexpected arguments');
    if (values.version) return output({version: JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version});
    if (!command || values.help) return output({commands: ['health', 'doctor --json', 'configure (private JSON stdin: url, token, privateHttp)', 'configure-slack (private JSON stdin: teamId, appId, botToken, appToken)', 'manifest --name NAME', 'setup --team T… --name NAME [--port 8788]', 'settings --channel C… [--thread ROOT_TS]', 'receipts [--key TEAM:EVENT]'], notes: 'Installed plugin only. Setup includes native controls by default: ez tools serve 18878:8788 slack setup --team T… --name NAME; open http://127.0.0.1:18878. Command name derives from NAME. Existing apps: update the generated manifest and reinstall for new permissions. Restart after configuration. Channel controls: !ez help. No arbitrary send or native execution command.'});
    if (command === 'manifest') return output(appManifest(values.name));
    const directory = resolve(process.env.EZ_SLACK_STATE ?? '/state');
    if (command === 'configure') { await saveConnection(directory, await jsonBody(process.stdin)); return output({configured:true, restartRequired:true}); }
    if (command === 'configure-slack') {
      const input = validateSlack(await jsonBody(process.stdin));
      await applicationCall('/v1/registration', undefined, await connection(directory));
      return output(await saveSlack(directory, input, new Slack()));
    }
    if (command === 'setup') {
      const port = Number(values.port ?? 8788);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid setup port');
      const server = await setup(directory, {port, teamId: values.team, name: values.name});
      output({setupReady:true, containerPort:port});
      for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
      return;
    }
    if (!['health','doctor','settings','receipts'].includes(command)) throw Error('Unknown command; use --help');
    const data = await rpc(directory, command, {...(values.channel ? {channel:values.channel} : {}), ...(values.thread !== undefined ? {threadTs:values.thread} : {}), ...(values.key ? {key:values.key} : {})});
    output({ok:true, data});
    if (command === 'doctor' && !data.connected) process.exitCode = 2;
  } catch (e) { process.stderr.write(JSON.stringify({ok:false,error:e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'Slack service or configuration unavailable' : e.message}) + '\n'); process.exitCode = 1; }
}
