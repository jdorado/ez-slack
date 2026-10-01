// One provider-owned control contract drives setup, Slack registration and help.
export const controls = Object.freeze([
  {name:'help', args:'', description:'List conversation controls', counts:[0]},
  {name:'status', args:'', description:'Read AI, conversation, work and delivery', counts:[0]},
  {name:'ai', args:'', description:'Read current settings and available choices', counts:[0]},
  {name:'select', args:'PRESET_ID', description:'Choose an AI preset', counts:[1]},
  {name:'model', args:'CLI MODEL [EFFORT]', description:'Choose a model and effort', counts:[2,3]},
  {name:'new', args:'', description:'Start a fresh conversation', counts:[0]},
  {name:'stop', args:'', description:'Cancel pending runs in this conversation', counts:[0]}
].map(Object.freeze));

export const controlUsage = () => controls.map(c => [c.name,c.args].filter(Boolean).join(' ')).join(' | ');
export const controlHelp = (prefix = '!ez') => controls.map(c => `${prefix} ${[c.name,c.args].filter(Boolean).join(' ')} — ${c.description}`).join('\n');

export function slashCommandFor(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9 _-]{1,40}$/.test(name)) throw Error('Supply --name BOT_NAME');
  const slug = name.toLowerCase().trim().replace(/[ _]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  if (!slug) throw Error('Supply --name BOT_NAME');
  const command = slug === 'ez' ? '/ez' : `/ez-${slug}`;
  if (command.length > 32) throw Error('Bot name is too long for its Slack command (maximum 28 characters after normalization)');
  return command;
}

export function appManifest(name = 'Ez Agent') {
  const command = slashCommandFor(name);
  return {
    display_information:{name,description:'Your native Ez agent, with one conversation per channel'},
    features:{bot_user:{display_name:name,always_online:false},slash_commands:[{
      command,description:'Control this channel\'s Ez conversation',usage_hint:controlUsage(),should_escape:false,
      // Slack's manifest schema requires a URL; Socket Mode delivers over its socket.
      url:'https://ez.invalid/slack/commands'
    }]},
    oauth_config:{scopes:{bot:['channels:history','groups:history','chat:write','commands','channels:read','groups:read']}},
    settings:{event_subscriptions:{bot_events:['message.channels','message.groups']},socket_mode_enabled:true,org_deploy_enabled:false,token_rotation_enabled:false}
  };
}
