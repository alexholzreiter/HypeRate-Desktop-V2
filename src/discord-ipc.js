// Minimal Discord IPC client — only what Rich Presence needs:
// handshake, SET_ACTIVITY, PING/PONG, close.
// Replaces discord-rpc, whose frame decoder shares one buffer across all
// connections and drops data when several frames arrive in one chunk.

const net    = require('net');
const path   = require('path');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const READY_TIMEOUT = 10000;
const MAX_FRAME     = 1024 * 1024;

function candidatePaths() {
  const paths = [];
  if (process.platform === 'win32') {
    for (let i = 0; i < 10; i++) paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    return paths;
  }
  const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
  const base = (XDG_RUNTIME_DIR || TMPDIR || TMP || TEMP || '/tmp').replace(/\/$/, '');
  // Flatpak / Snap builds of Discord put the socket in a subdirectory (Linux)
  const dirs = [base, path.join(base, 'app/com.discordapp.Discord'), path.join(base, 'snap.discord')];
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) paths.push(path.join(dir, `discord-ipc-${i}`));
  }
  return paths;
}

// Resolves with a client once Discord sends READY.
// Rejects if Discord isn't reachable (err.code = 'NOT_FOUND'), doesn't answer,
// or refuses the handshake (err.rejected = true, message from Discord).
// onClose fires once if an established connection is lost — not after client.close().
function connect(clientId, { onClose } = {}) {
  return new Promise((resolve, reject) => {
    const paths   = candidatePaths();
    const pending = new Map(); // nonce -> { resolve, reject }
    let sock = null, buf = Buffer.alloc(0);
    let ready = false, ended = false, readyTimer = null;
    let onCloseCb = onClose;

    function end(err, graceful = false) {
      if (ended) return;
      ended = true;
      clearTimeout(readyTimer);
      if (sock) {
        if (graceful) { sock.end(); setTimeout(() => sock.destroy(), 1000).unref(); }
        else sock.destroy();
      }
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      if (ready) onCloseCb?.(err);
      else reject(err);
    }

    function send(op, data) {
      if (ended || !sock) return;
      const json   = Buffer.from(JSON.stringify(data), 'utf8');
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(json.length, 4);
      sock.write(Buffer.concat([header, json]));
    }

    const client = {
      request(cmd, args) {
        if (ended) return Promise.reject(new Error('Connection closed'));
        return new Promise((res, rej) => {
          const nonce = crypto.randomUUID();
          pending.set(nonce, { resolve: res, reject: rej });
          send(OP.FRAME, { cmd, args, nonce });
        });
      },
      setActivity(activity) { return client.request('SET_ACTIVITY', { pid: process.pid, activity }); },
      clearActivity()       { return client.request('SET_ACTIVITY', { pid: process.pid }); },
      close() {
        onCloseCb = null;
        send(OP.CLOSE, {});
        end(new Error('Connection closed'), true);
      },
    };

    function onFrame(op, data) {
      if (op === OP.PING) {
        send(OP.PONG, data);
      } else if (op === OP.CLOSE) {
        const err = new Error(data?.message || 'Discord closed the connection');
        err.code = data?.code;
        err.rejected = !ready;
        end(err);
      } else if (op === OP.FRAME && data) {
        if (data.cmd === 'DISPATCH' && data.evt === 'READY') {
          if (!ready) { ready = true; clearTimeout(readyTimer); resolve(client); }
        } else if (data.nonce && pending.has(data.nonce)) {
          const p = pending.get(data.nonce);
          pending.delete(data.nonce);
          if (data.evt === 'ERROR') {
            const err = new Error(data.data?.message || 'Discord error');
            err.code = data.data?.code;
            p.reject(err);
          } else {
            p.resolve(data.data);
          }
        }
      }
    }

    // Frames: int32 LE opcode, int32 LE length, JSON body. Chunks may split or join frames.
    function onData(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (!ended && buf.length >= 8) {
        const op  = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (len < 0 || len > MAX_FRAME) return end(new Error('Invalid frame from Discord'));
        if (buf.length < 8 + len) break;
        const body = buf.subarray(8, 8 + len);
        buf = buf.subarray(8 + len);
        let data = null;
        try { data = JSON.parse(body.toString('utf8')); } catch {}
        onFrame(op, data);
      }
    }

    function tryPath(i) {
      if (i >= paths.length) {
        const err = new Error('Discord is not running');
        err.code = 'NOT_FOUND';
        return end(err);
      }
      const s = net.createConnection(paths[i]);
      const onError = () => { s.destroy(); tryPath(i + 1); };
      s.once('error', onError);
      s.once('connect', () => {
        s.removeListener('error', onError);
        sock = s;
        s.on('error', err => end(err));
        s.on('close', () => end(new Error('Connection closed')));
        s.on('data', onData);
        readyTimer = setTimeout(() => end(new Error('Discord did not respond')), READY_TIMEOUT);
        send(OP.HANDSHAKE, { v: 1, client_id: clientId });
      });
    }

    tryPath(0);
  });
}

module.exports = { connect };
