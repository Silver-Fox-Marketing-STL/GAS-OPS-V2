// Mock of google.script.run: chainable withSuccessHandler / withFailureHandler /
// withUserObject, then any function name → looks up window.MOCK[name]
// (value, or function(args...) → value / throws) and calls the handler async.
(function () {
  window.MOCK_CALLS = [];
  window.MOCK_UNKNOWN = [];
  window.MOCK_NEVER = { __never: true };
  var LATENCY = 15;   // ms — keeps ordering realistic without slowing the harness

  function makeRunner() {
    var okCb = null, errCb = null, userObj = null;
    var proxy;
    var runner = {
      withSuccessHandler: function (cb) { okCb = cb; return proxy; },
      withFailureHandler: function (cb) { errCb = cb; return proxy; },
      withUserObject: function (o) { userObj = o; return proxy; }
    };
    proxy = new Proxy(runner, {
      get: function (target, name) {
        if (name in target) return target[name];
        if (typeof name !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          window.MOCK_CALLS.push({ fn: name, args: args });
          var spec = window.MOCK ? window.MOCK[name] : undefined;
          if (spec === undefined) {
            window.MOCK_UNKNOWN.push(name);
            console.warn('[mock] no mock for ' + name + '(' + JSON.stringify(args).slice(0, 120) + ')');
            spec = function () { return null; };
          }
          setTimeout(function () {
            var val; 
            try {
              val = (typeof spec === 'function') ? spec.apply(null, args) : spec;
            } catch (e) {
              if (errCb) errCb(e, userObj);
              return;
            }
            if (val === window.MOCK_NEVER) return;   // simulate a call that never returns
            // deep-clone so views can't mutate the fixture
            if (val !== null && typeof val === 'object') val = JSON.parse(JSON.stringify(val));
            if (okCb) okCb(val, userObj);
          }, LATENCY);
          return undefined;
        };
      }
    });
    return proxy;
  }

  window.google = {
    script: {
      run: new Proxy({}, {
        get: function (t, name) {
          return makeRunner()[name];
        }
      }),
      host: { close: function () {}, setWidth: function () {}, setHeight: function () {} },
      url: { getLocation: function (cb) { cb({ parameter: {}, parameters: {}, hash: '' }); } }
    }
  };
})();
