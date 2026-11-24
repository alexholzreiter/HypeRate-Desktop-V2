// A host that is not in "network", and storage without the "storage" permission
fetch('https://example.com/').then(() => hyperate.log('FETCH WENT THROUGH'), () => hyperate.log('fetch blocked'));
hyperate.storage.set('x', 1).then(ok => hyperate.log('storage ' + ok));
