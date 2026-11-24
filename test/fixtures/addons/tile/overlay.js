hyperate.on('heartRate', ({ bpm }) => { document.getElementById('bpm').textContent = bpm; });
hyperate.on('message', ({ n }) => { document.getElementById('n').textContent = n; hyperate.log('got ' + n); });
