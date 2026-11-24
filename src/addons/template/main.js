// An example HypeRate Desktop addon: a notification when your heart rate climbs above a limit.
// Change it, or ask an AI assistant to change it: AGENTS.md next to this file explains everything.

const LIMIT = 120;
let above = false;

hyperate.on('heartRate', async ({ bpm }) => {
  if (bpm > LIMIT && !above) {
    above = true;
    const times = ((await hyperate.storage.get('times')) || 0) + 1;
    await hyperate.storage.set('times', times);
    hyperate.notify('Heart rate high', `${bpm} BPM, above ${LIMIT} for the ${times}. time`);
    hyperate.log(`above ${LIMIT}: ${bpm} BPM`);
  } else if (bpm < LIMIT - 5) {
    above = false;   // a little below the limit before it counts again, so it does not flicker
  }
});

hyperate.log('ready, waiting for a heart rate');
