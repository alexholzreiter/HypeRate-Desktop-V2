// Spins 190 ms of every 200 ms
setInterval(() => { const end = Date.now() + 190; while (Date.now() < end) {} }, 200);
