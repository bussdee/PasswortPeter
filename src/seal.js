/* PasswortPeter – Siegel
 *
 * Jede Seite bekommt ein Erkennungszeichen. Favicons scheiden aus: sie nachzuladen
 * würde einem fremden Server mitteilen, welche Seiten hier im Tresor liegen.
 * Also wird das Zeichen aus einem BLAKE2b-Hash des Namens erzeugt, rein rechnerisch,
 * ohne einen einzigen Netzzugriff.
 *
 * Aufbau: eine Scheibe, ein Kranz aus 12 Kerben, ein Buchstabe in der Mitte.
 * Farbe, Kranzmuster und Drehung stammen aus dem Hash. Gleicher Name, gleiches
 * Siegel, auf jedem Gerät.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PPSeal = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var sodium = null;
  var cache = Object.create(null);

  function init(s) { sodium = s; cache = Object.create(null); return api; }

  function hash(text) {
    var input = String(text || '?');
    if (sodium && typeof sodium.crypto_generichash === 'function') {
      return sodium.crypto_generichash(16, input);
    }
    /* Notnagel, falls libsodium noch nicht bereit ist. Rein optisch, nie für
     * irgendetwas Sicherheitsrelevantes. */
    var out = new Uint8Array(16), i, h = 0x811c9dc5;
    for (i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      out[i % 16] ^= h & 255;
    }
    return out;
  }

  function initial(text) {
    var s = String(text || '').trim();
    var m = s.match(/[\p{L}\p{N}]/u);
    return m ? m[0].toUpperCase() : '?';
  }

  function escapeText(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Liefert fertiges SVG-Markup. Der einzige Text darin ist ein einzelner
   * Buchstabe, und der wird maskiert. */
  function svg(seed, label) {
    var key = seed + '\u0000' + (label || '');
    if (cache[key]) { return cache[key]; }

    var h = hash(seed);
    var hue = Math.round(h[0] * 360 / 256);
    var sat = 32 + (h[1] % 26);            // 32..57
    var drehung = (h[2] % 30);

    /* 12 Kerben, gefüllt nach den Bits aus zwei Hash-Bytes. */
    var bits = (h[3] << 8) | h[4];
    var kerben = [], i, anzahl = 0;
    for (i = 0; i < 12; i++) {
      var an = ((bits >> i) & 1) === 1;
      if (an) { anzahl++; }
      kerben.push(an);
    }
    /* Weder ein leerer noch ein voller Kranz. Beides sähe gleich aus. */
    for (i = 0; anzahl < 4 && i < 12; i++) { if (!kerben[i]) { kerben[i] = true; anzahl++; } }
    for (i = 0; anzahl > 9 && i < 12; i++) { if (kerben[i]) { kerben[i] = false; anzahl--; } }

    var scheibe = 'hsl(' + hue + ',' + sat + '%,90%)';
    var zeichen = 'hsl(' + hue + ',' + Math.min(sat + 18, 70) + '%,29%)';
    var kranz = 'hsl(' + hue + ',' + sat + '%,62%)';

    var parts = [];
    parts.push('<circle cx="20" cy="20" r="19" fill="' + scheibe + '"/>');
    for (i = 0; i < 12; i++) {
      if (!kerben[i]) { continue; }
      var winkel = (i * 30 + drehung) * Math.PI / 180;
      var x = (20 + Math.cos(winkel) * 15.6).toFixed(2);
      var y = (20 + Math.sin(winkel) * 15.6).toFixed(2);
      parts.push('<circle cx="' + x + '" cy="' + y + '" r="1.9" fill="' + kranz + '"/>');
    }
    parts.push('<circle cx="20" cy="20" r="11.2" fill="none" stroke="' + kranz + '" stroke-width="0.9" opacity="0.55"/>');
    parts.push(
      '<text x="20" y="20" fill="' + zeichen + '" font-family="ui-monospace,Menlo,Consolas,monospace"' +
      ' font-size="13" font-weight="700" text-anchor="middle" dominant-baseline="central">' +
      escapeText(initial(label || seed)) + '</text>'
    );

    var out = '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
      parts.join('') + '</svg>';
    cache[key] = out;
    return out;
  }

  var api = { init: init, svg: svg, initial: initial };
  return api;
}));
