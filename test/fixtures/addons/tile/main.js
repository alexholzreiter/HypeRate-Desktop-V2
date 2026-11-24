// Counts heart rate updates and sends the count to the overlay
let n = 0;
hyperate.on('heartRate', () => hyperate.send({ n: ++n }));
