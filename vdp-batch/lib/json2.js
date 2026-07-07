// json2.js -- minimal JSON for ExtendScript (ES3), based on Douglas Crockford's
// public-domain json2.js (https://github.com/douglascrockford/JSON-js).
// ExtendScript has no native JSON, so this provides JSON.parse / JSON.stringify.
// Trimmed to what vdp-batch.jsx needs: string/number/boolean/null/array/object.

if (typeof JSON !== 'object') { JSON = {}; }

(function () {
    'use strict';

    // Pure escape sequences only -- never embed raw control/line-separator chars in
    // a regex literal (U+2028 / U+2029 are JS line terminators and would make the
    // literal itself a syntax error: "missing /"). Our JSON is ASCII (dealer keys,
    // types, Windows paths), so escaping backslash, quote, and control chars suffices.
    var escapable = /[\\\"\x00-\x1f\x7f-\x9f]/g;
    var meta = {
        '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r',
        '"': '\\"', '\\': '\\\\'
    };

    function quote(string) {
        escapable.lastIndex = 0;
        return escapable.test(string)
            ? '"' + string.replace(escapable, function (a) {
                var c = meta[a];
                return typeof c === 'string'
                    ? c
                    : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
            }) + '"'
            : '"' + string + '"';
    }

    function str(key, holder) {
        var i, k, v, length, partial, value = holder[key];
        switch (typeof value) {
            case 'string':
                return quote(value);
            case 'number':
                return isFinite(value) ? String(value) : 'null';
            case 'boolean':
            case 'null':
                return String(value);
            case 'object':
                if (!value) { return 'null'; }
                partial = [];
                if (Object.prototype.toString.apply(value) === '[object Array]') {
                    length = value.length;
                    for (i = 0; i < length; i += 1) {
                        partial[i] = str(i, value) || 'null';
                    }
                    return '[' + partial.join(',') + ']';
                }
                for (k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = str(k, value);
                        if (v) { partial.push(quote(k) + ':' + v); }
                    }
                }
                return '{' + partial.join(',') + '}';
        }
        return undefined;
    }

    if (typeof JSON.stringify !== 'function') {
        JSON.stringify = function (value) {
            return str('', { '': value });
        };
    }

    if (typeof JSON.parse !== 'function') {
        JSON.parse = function (text) {
            text = String(text);
            // Crockford's four-stage security check before eval: reject anything
            // that isn't well-formed JSON so eval can't run arbitrary code.
            if (/^[\],:{}\s]*$/.test(
                    text
                        .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
                        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
                        .replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {
                return eval('(' + text + ')');
            }
            throw new SyntaxError('JSON.parse: malformed JSON');
        };
    }
}());
