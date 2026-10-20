// Settings safety net. localStorage can lose its most recent changes when Quantm is closed by force
// (an installer replacing it, Task Manager, a crash). Every quantm.* key is mirrored to a file in the
// user data folder as it changes, and anything the storage lost is put back here, before the app reads it.
// A classic script so it runs before the app's modules.
(function () {
  var bridge = window.native && window.native.prefs;
  if (!bridge) return;
  // changes every few seconds and only matters for "resume where you left off"
  var SKIP = { 'quantm.session': true };
  var mirrored = function (key) { return /^quantm\./.test(key) && !SKIP[key]; };

  var saved = {};
  try { saved = bridge.load() || {}; } catch (e) { saved = {}; }
  var keys = Object.keys(saved);
  keys.forEach(function (key) {
    if (!mirrored(key) || typeof saved[key] !== 'string') return;
    try {
      if (localStorage.getItem(key) !== saved[key]) localStorage.setItem(key, saved[key]);
    } catch (e) { /* storage unavailable */ }
  });

  var pending = {};
  var timer = null;
  function flush() {
    clearTimeout(timer);
    timer = null;
    var batch = pending;
    pending = {};
    if (Object.keys(batch).length) {
      try { bridge.save(batch); } catch (e) { /* best effort */ }
    }
  }
  function queue(key, value) {
    if (!mirrored(key)) return;
    pending[key] = value;
    if (!timer) timer = setTimeout(flush, 250);
  }

  // first run with the safety net: back up what's there now
  if (!keys.length) {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (mirrored(key)) pending[key] = localStorage.getItem(key);
      }
    } catch (e) { /* storage unavailable */ }
    flush();
  }

  var proto = Storage.prototype;
  var setItem = proto.setItem;
  var removeItem = proto.removeItem;
  proto.setItem = function (key, value) {
    setItem.call(this, key, value);
    if (this === window.localStorage) queue(String(key), String(value));
  };
  proto.removeItem = function (key) {
    removeItem.call(this, key);
    if (this === window.localStorage) queue(String(key), null);
  };
  window.addEventListener('pagehide', flush);
})();
