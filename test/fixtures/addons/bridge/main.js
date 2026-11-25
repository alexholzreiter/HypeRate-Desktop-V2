// Each call through the app's integrations, and what comes back
const show = (name, r) => hyperate.log(`${name} ${r.ok ? 'ok' : r.reason}`);
(async () => {
  show('discord', await hyperate.discord.setStatus('Boss down at 142 BPM'));
  show('discord-again', await hyperate.discord.setStatus('too soon'));
  show('chatbox', await hyperate.vrchat.chatbox('GG! 142 BPM'));
  show('param-bool', await hyperate.vrchat.parameter('BossDown', true));
  show('param-int', await hyperate.vrchat.parameter('Kills', 3));
  show('param-float', await hyperate.vrchat.parameter('Heat', 0.5));
  show('param-bad', await hyperate.vrchat.parameter('/avatar/parameters/x y', 1));
  show('ha', await hyperate.homeAssistant.event('boss_down', { bpm: 142 }));
  show('ha-bad', await hyperate.homeAssistant.event('has space', {}));
  hyperate.log('bridge done');
})();
