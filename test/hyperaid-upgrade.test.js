const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHyperaid } = require('../src/games/wow/hyperaid');
const { liveFontBytes } = require('../src/games/wow/hyperaid-font');

const bundle = path.join(__dirname, '../assets/hyperaid/HypeRaid');
const initialTime = 8_002_000;
const liveSlot = 'Live1001.ttf';

async function check(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperaid-upgrade-'));
  const forever = path.join(root, '_forever_');
  const addons = path.join(forever, 'Interface', 'AddOns');
  const addon = path.join(addons, 'HypeRaid');
  const legacy = path.join(addon, 'LiveFonts');
  const data = path.join(addons, 'HypeRaidData', 'LiveFonts');
  await fs.mkdir(addons, { recursive: true });
  let now = initialTime;
  const client = createHyperaid(() => {}, { clock: () => now });
  const configure = () => client.configure({ enabled: true, folder: forever });
  async function replaceAddon() {
    await fs.rm(addon, { recursive: true, force: true });
    await fs.cp(bundle, addon, { recursive: true });
  }
  async function expectPulse(bank, bpm) {
    client.record(bpm);
    await client.tick();
    assert.equal(client.status().state, 'writing');
    assert.deepEqual(await fs.readFile(path.join(bank, liveSlot)), liveFontBytes(1001, bpm, 8002));
  }
  try {
    await run({ addon, data, legacy, client, configure, replaceAddon, expectPulse,
      advanceClock: milliseconds => { now += milliseconds; } });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  await check(async ({ addon, data, legacy, client, configure, replaceAddon, expectPulse }) => {
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(addon, 'HypeRaid.toc'), '## Version: 0.4.2\n');
    await fs.writeFile(path.join(addon, 'FontBank.lua'), 'addon.fontBankSize = 4096\naddon.fontInterval = 8\n');
    for (const slot of ['Live0001.ttf', liveSlot, 'Live1002.ttf', 'Live4096.ttf']) {
      await fs.writeFile(path.join(legacy, slot), '');
    }
    assert.equal((await configure()).bank, legacy);
    await expectPulse(legacy, 82);
    await replaceAddon();
    client.record(83);
    await client.tick();
    await expectPulse(data, 83);
    await replaceAddon();
    await expectPulse(data, 84);
    assert.equal((await configure()).bank, data);
    console.log('PASS Desktop-first upgrade, live migration, and subsequent CurseForge replacement');
  });

  await check(async ({ addon, data, client, configure, replaceAddon, expectPulse }) => {
    await replaceAddon();
    const manifestPath = path.join(addon, 'HypeRaid.toc');
    const bundled = (await fs.readFile(manifestPath, 'utf8')).match(/## Version: (\d+)\.(\d+)\.(\d+)/);
    const newer = `${bundled[1]}.${bundled[2]}.${Number(bundled[3]) + 1}`;
    const manifest = (await fs.readFile(manifestPath, 'utf8')).replace(bundled[0], `## Version: ${newer}`);
    await fs.writeFile(manifestPath, manifest);
    assert.equal((await configure()).bank, data);
    assert.equal((await client.install()).installedVersion, newer);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifest);
    assert.match(await fs.readFile(path.join(addon, 'FontBank.lua'), 'utf8'), /fontBankSize = 0/);
    await expectPulse(data, 85);
    await fs.unlink(path.join(data, liveSlot));
    client.record(86);
    await client.tick();
    await expectPulse(data, 86);
    console.log('PASS Addon-first upgrade, newer addon preservation, and missing slot recovery');
  });

  await check(async ({ addon, data, client, configure, expectPulse }) => {
    assert.equal((await configure()).state, 'setup');
    assert.equal((await client.install()).bank, data);
    assert.match(await fs.readFile(path.join(addon, 'FontBank.lua'), 'utf8'), /fontBankSize = 0/);
    await expectPulse(data, 87);
    console.log('PASS Fresh bundled installation with an independent pulse feed');
  });

  await check(async ({ client, configure, replaceAddon, advanceClock }) => {
    await replaceAddon();
    await configure();
    const rename = fs.rename;
    try {
      fs.rename = async () => { throw Object.assign(new Error('Temporary file error'), { code: 'EIO' }); };
      client.record(95);
      await client.tick();
      assert.equal(client.status().state, 'error');
      assert.equal(client.status().error, 'EIO');
    } finally {
      fs.rename = rename;
    }
    advanceClock(8000);
    client.record(95);
    await client.tick();
    await client.tick();
    assert.equal(client.status().state, 'writing');
    assert.equal(client.status().error, undefined);
    console.log('PASS A temporary write error recovers without restarting the sender');
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
