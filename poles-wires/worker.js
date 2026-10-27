/* Parses dropped files off the main thread so the map stays responsive. */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'pnw-core.js');
self.onmessage = function (e) {
  var m = e.data;
  try { self.postMessage({ id: m.id, result: PNW.importFile(XLSX, m.name, m.buffer, m.role || null) }); }
  catch (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); }
};
