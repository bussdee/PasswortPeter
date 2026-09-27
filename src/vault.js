/* PasswortPeter – Tresorkern
 *
 * Kein DOM, kein Netz. Reine Logik, damit sie in Node getestet werden kann.
 * Läuft als klassisches <script> (keine ES-Module, die sind unter file:// gesperrt).
 *
 * DATEIFORMAT  .peter
 *
 *   Offset  Größe  Inhalt
 *   ------  -----  ------------------------------------------------
 *        0      6  Magic "PPETER"
 *        6      1  Formatversion (1)
 *        7      1  KDF-Verfahren (2 = Argon2id v1.3)
 *        8      4  opslimit            uint32, big endian
 *       12      4  memlimit in KiB     uint32, big endian
 *       16     16  Salz
 *       32     24  Nonce
 *       56    ...  Geheimtext (XChaCha20-Poly1305, Tag inklusive)
 *
 *   Zusatzdaten der AEAD (additional data) sind die Bytes 0..31, also Magic,
 *   Versionen, KDF-Parameter und Salz. Damit kann niemand die Parameter im Kopf
 *   herunterdrehen, ohne dass die Entschlüsselung auffliegt.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PPVault = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAGIC = [0x50, 0x50, 0x45, 0x54, 0x45, 0x52]; // "PPETER"
  var FORMAT_VERSION = 1;
  var KDF_ARGON2ID = 2;
  var SALT_LEN = 16;
  var NONCE_LEN = 24;
  var KEY_LEN = 32;
  var HEADER_LEN = 56;
  var AD_LEN = 32;

  /* Argon2id-Vorgaben. Gemessen im WASM: 128 MiB / t=3 braucht rund 0,9 s auf
   * einem Rechner, auf einem älteren Handy das Drei- bis Fünffache. Weil es ohne
   * Server keine Anmeldesperre gibt, ist das hier die einzige Bremse gegen einen
   * Angreifer, der die Datei hat. Die Werte stehen im Dateikopf und sind damit
   * später änderbar, ohne alte Tresore unlesbar zu machen. */
  var KDF_DEFAULT = { ops: 3, memKiB: 128 * 1024 };
  var KDF_SPARSAM = { ops: 4, memKiB: 48 * 1024 };   // Rückfall für schwache Geräte
  var KDF_MIN = { ops: 2, memKiB: 19 * 1024 };       // darunter wird nichts akzeptiert

  var sodium = null;

  function init(sodiumInstance) {
    sodium = sodiumInstance;
    return api;
  }

  function requireSodium() {
    if (!sodium || typeof sodium.crypto_pwhash !== 'function') {
      throw new Error('libsodium ist nicht bereit oder ohne Argon2id gebaut.');
    }
  }

  /* ------------------------------------------------------------ Hilfsmittel */

  function u32be(n) {
    return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  }

  function readU32be(bytes, at) {
    return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  }

  function concat(parts) {
    var total = 0, i;
    for (i = 0; i < parts.length; i++) { total += parts[i].length; }
    var out = new Uint8Array(total), at = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], at); at += parts[i].length; }
    return out;
  }

  /* UTF-8 ohne fremde Hilfe.
   *
   * TextEncoder gibt es in jedem heutigen Browser, aber nicht überall (jsdom
   * etwa hat ihn nicht). Der Rückfall griff früher nach Nodes Buffer, den es im
   * Browser nicht gibt. Also wird hier notfalls selbst kodiert. Ein Tresorkern,
   * der von einer fremden Umgebung abhängt, ist kein Tresorkern. */

  function utf8EncodeSelbst(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) { out.push(c); }
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xd800 && c <= 0xdbff) {
        c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          i++;
          cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else {
          out.push(0xef, 0xbf, 0xbd); // einsame Ersatzhälfte wird zum Ersatzzeichen
        }
      }
      else if (c >= 0xdc00 && c <= 0xdfff) { out.push(0xef, 0xbf, 0xbd); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return new Uint8Array(out);
  }

  function utf8DecodeSelbst(bytes) {
    var s = '', i = 0, c, c2, c3, c4, cp, stueck = [];
    while (i < bytes.length) {
      c = bytes[i++];
      if (c < 0x80) { stueck.push(c); }
      else if (c >= 0xc0 && c < 0xe0) {
        c2 = bytes[i++]; stueck.push(((c & 31) << 6) | (c2 & 63));
      } else if (c >= 0xe0 && c < 0xf0) {
        c2 = bytes[i++]; c3 = bytes[i++];
        stueck.push(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      } else if (c >= 0xf0) {
        c2 = bytes[i++]; c3 = bytes[i++]; c4 = bytes[i++];
        cp = (((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63)) - 0x10000;
        stueck.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        stueck.push(0xfffd);
      }
      /* In Häppchen, sonst sprengt ein großer Tresor den Aufrufstapel. */
      if (stueck.length > 4096) { s += String.fromCharCode.apply(null, stueck); stueck = []; }
    }
    if (stueck.length) { s += String.fromCharCode.apply(null, stueck); }
    return s;
  }

  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') { return new TextEncoder().encode(str); }
    return utf8EncodeSelbst(str);
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    return utf8DecodeSelbst(bytes);
  }

  function randomId() {
    requireSodium();
    var b = sodium.randombytes_buf(9);
    var s = '';
    for (var i = 0; i < b.length; i++) { s += ('0' + b[i].toString(16)).slice(-2); }
    return s;
  }

  function nowIso() { return new Date().toISOString(); }

  /* --------------------------------------------------------- Datenmodell */

  var CATEGORY_COLORS = ['rost', 'moos', 'tinte', 'messing', 'pflaume', 'schiefer', 'ziegel', 'salbei'];

  function emptyVault(name) {
    return {
      v: 1,
      name: String(name || 'Tresor'),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      settings: defaultSettings(),
      categories: [],
      items: []
    };
  }

  function newCategory(name, color) {
    return {
      id: randomId(),
      name: String(name || ''),
      color: CATEGORY_COLORS.indexOf(color) >= 0 ? color : CATEGORY_COLORS[0],
      order: 0
    };
  }

  function newItem(fields) {
    var f = fields || {};
    return {
      id: randomId(),
      cat: f.cat || null,
      title: String(f.title || ''),
      url: String(f.url || ''),
      user: String(f.user || ''),
      pass: String(f.pass || ''),
      note: String(f.note || ''),
      fav: !!f.fav,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      usedAt: null,
      deletedAt: null
    };
  }

  /* Ein Eintrag ohne Benutzer und ohne Passwort ist ein reines Lesezeichen. */
  function isBookmark(item) {
    return !item.user && !item.pass;
  }

  /* Prüft und repariert einen entschlüsselten Tresor. Alles, was aus einer Datei
   * kommt, ist erst mal fremd, auch wenn die AEAD bestätigt, dass es echt ist. */
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Der Inhalt des Tresors ist kein gültiger Datensatz.');
    }
    var v = emptyVault(typeof raw.name === 'string' ? raw.name : 'Tresor');
    v.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : nowIso();
    v.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso();
    v.settings = sanitizeSettings(raw.settings);

    var seenCat = Object.create(null);
    (Array.isArray(raw.categories) ? raw.categories : []).forEach(function (c, i) {
      if (!c || typeof c !== 'object') { return; }
      var id = typeof c.id === 'string' && c.id ? c.id : randomId();
      if (seenCat[id]) { return; }
      seenCat[id] = true;
      v.categories.push({
        id: id,
        name: typeof c.name === 'string' ? c.name : '',
        color: CATEGORY_COLORS.indexOf(c.color) >= 0 ? c.color : CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        order: typeof c.order === 'number' && isFinite(c.order) ? c.order : i
      });
    });

    var seenItem = Object.create(null);
    (Array.isArray(raw.items) ? raw.items : []).forEach(function (it) {
      if (!it || typeof it !== 'object') { return; }
      var id = typeof it.id === 'string' && it.id ? it.id : randomId();
      if (seenItem[id]) { return; }
      seenItem[id] = true;
      var str = function (x) { return typeof x === 'string' ? x : ''; };
      v.items.push({
        id: id,
        cat: (typeof it.cat === 'string' && seenCat[it.cat]) ? it.cat : null,
        title: str(it.title),
        url: str(it.url),
        user: str(it.user),
        pass: str(it.pass),
        note: str(it.note),
        fav: !!it.fav,
        createdAt: str(it.createdAt) || nowIso(),
        updatedAt: str(it.updatedAt) || nowIso(),
        usedAt: str(it.usedAt) || null,
        deletedAt: str(it.deletedAt) || null
      });
    });

    return v;
  }

  /* ----------------------------------------------------------- Adressen */

  /* Nur http und https dürfen in ein href. Alles andere, insbesondere
   * javascript: und data:, wird verworfen. */
  function safeUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) { return null; }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) { s = 'https://' + s; }
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') { return null; }
    return u.href;
  }

  function hostOf(raw) {
    var href = safeUrl(raw);
    if (!href) { return ''; }
    try { return new URL(href).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  /* ------------------------------------------------------- Schlüssel */

  function deriveKey(password, salt, ops, memKiB) {
    requireSodium();
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Das Master-Passwort fehlt.');
    }
    if (ops < KDF_MIN.ops || memKiB < KDF_MIN.memKiB) {
      throw new Error('Die Parameter der Schlüsselableitung sind zu schwach.');
    }
    return sodium.crypto_pwhash(
      KEY_LEN,
      utf8Encode(password),
      salt,
      ops,
      memKiB * 1024,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    );
  }

  /* --------------------------------------------------- Ver- und Entschlüsseln */

  function encrypt(vaultData, password, kdf) {
    requireSodium();
    var params = kdf || KDF_DEFAULT;
    var salt = sodium.randombytes_buf(SALT_LEN);
    var nonce = sodium.randombytes_buf(NONCE_LEN);

    var head = concat([
      new Uint8Array(MAGIC),
      new Uint8Array([FORMAT_VERSION, KDF_ARGON2ID]),
      u32be(params.ops),
      u32be(params.memKiB),
      salt
    ]);
    if (head.length !== AD_LEN) { throw new Error('Innerer Fehler: Kopf hat die falsche Länge.'); }

    var data = sanitize(vaultData);
    data.updatedAt = nowIso();
    var plain = utf8Encode(JSON.stringify(data));

    var key = deriveKey(password, salt, params.ops, params.memKiB);
    var cipher;
    try {
      cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, head, null, nonce, key);
    } finally {
      sodium.memzero(key);
      sodium.memzero(plain);
    }
    return concat([head, nonce, cipher]);
  }

  function readHeader(bytes) {
    if (!(bytes instanceof Uint8Array)) { bytes = new Uint8Array(bytes); }
    if (bytes.length < HEADER_LEN + 16) {
      throw new Error('Die Datei ist zu kurz für einen Tresor.');
    }
    for (var i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) {
        throw new Error('Das ist keine PasswortPeter-Datei.');
      }
    }
    var formatVersion = bytes[6];
    if (formatVersion !== FORMAT_VERSION) {
      throw new Error('Diese Datei stammt aus Version ' + formatVersion + '. Dieses Programm kennt nur Version ' + FORMAT_VERSION + '.');
    }
    if (bytes[7] !== KDF_ARGON2ID) {
      throw new Error('Unbekanntes Verfahren zur Schlüsselableitung.');
    }
    var ops = readU32be(bytes, 8);
    var memKiB = readU32be(bytes, 12);
    if (ops < KDF_MIN.ops || memKiB < KDF_MIN.memKiB) {
      throw new Error('Die Datei nennt zu schwache Parameter. Das sieht nach Manipulation aus.');
    }
    if (ops > 64 || memKiB > 2 * 1024 * 1024) {
      throw new Error('Die Datei nennt unsinnig hohe Parameter. Das sieht nach Manipulation aus.');
    }
    return {
      formatVersion: formatVersion,
      ops: ops,
      memKiB: memKiB,
      salt: bytes.slice(16, 32),
      nonce: bytes.slice(32, 56),
      ad: bytes.slice(0, AD_LEN),
      cipher: bytes.slice(HEADER_LEN)
    };
  }

  function decrypt(bytes, password) {
    requireSodium();
    var h = readHeader(bytes);
    var key = deriveKey(password, h.salt, h.ops, h.memKiB);
    var plain;
    try {
      plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, h.cipher, h.ad, h.nonce, key);
    } catch (e) {
      throw new Error('Falsches Master-Passwort, oder die Datei ist beschädigt.');
    } finally {
      sodium.memzero(key);
    }
    var text;
    try {
      text = utf8Decode(plain);
    } finally {
      sodium.memzero(plain);
    }
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error('Der Tresor ließ sich öffnen, aber sein Inhalt ist unlesbar.');
    }
    return { data: sanitize(raw), kdf: { ops: h.ops, memKiB: h.memKiB } };
  }

  /* ------------------------------------------------- Passwortgenerator */

  var ABC = {
    klein: 'abcdefghijkmnopqrstuvwxyz',      // ohne l
    gross: 'ABCDEFGHJKLMNPQRSTUVWXYZ',       // ohne I und O
    zahl: '23456789',                        // ohne 0 und 1
    zeichen: '!@#$%&*+-=?_'
  };

  /* Gleichverteilt, ohne Modulo-Schiefstand: zu große Werte werden verworfen. */
  function pick(alphabet) {
    requireSodium();
    var n = alphabet.length;
    var limit = 256 - (256 % n);
    for (;;) {
      var b = sodium.randombytes_buf(1)[0];
      if (b < limit) { return alphabet.charAt(b % n); }
    }
  }

  function shuffle(arr) {
    requireSodium();
    for (var i = arr.length - 1; i > 0; i--) {
      var limit = 256 - (256 % (i + 1)), b;
      do { b = sodium.randombytes_buf(1)[0]; } while (b >= limit);
      var j = b % (i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function generatePassword(opts) {
    var o = opts || {};
    var len = Math.max(8, Math.min(128, o.length || 20));
    var sets = [];
    var out = [];
    if (o.klein !== false) { sets.push(ABC.klein); out.push(pick(ABC.klein)); }
    if (o.gross !== false) { sets.push(ABC.gross); out.push(pick(ABC.gross)); }
    if (o.zahl !== false) { sets.push(ABC.zahl); out.push(pick(ABC.zahl)); }
    if (o.zeichen) { sets.push(ABC.zeichen); out.push(pick(ABC.zeichen)); }
    if (sets.length === 0) { sets.push(ABC.klein); out.push(pick(ABC.klein)); }
    var pool = sets.join('');
    while (out.length < len) { out.push(pick(pool)); }
    return shuffle(out).join('');
  }

  /* Entropie in Bit, ehrlich gerechnet: Länge mal Logarithmus der Alphabetgröße. */
  function passwordBits(pw) {
    var s = String(pw || '');
    if (!s) { return 0; }
    var pool = 0;
    if (/[a-z]/.test(s)) { pool += 26; }
    if (/[A-Z]/.test(s)) { pool += 26; }
    if (/[0-9]/.test(s)) { pool += 10; }
    if (/[^a-zA-Z0-9]/.test(s)) { pool += 33; }
    if (!pool) { return 0; }
    return Math.round(s.length * (Math.log(pool) / Math.log(2)));
  }

  /* Bewertet ein Master-Passwort. Bewusst streng, weil es kein Zurück gibt:
   * ohne dieses Passwort ist der Tresor endgültig verloren. */
  function ratePassword(pw) {
    var s = String(pw || '');
    var bits = passwordBits(s);
    if (/^(.)\1*$/.test(s) && s.length > 0) { bits = Math.min(bits, 8); }
    var stufe, text;
    if (s.length < 8) { stufe = 0; text = 'Zu kurz'; }
    else if (bits < 45) { stufe = 1; text = 'Schwach'; }
    else if (bits < 65) { stufe = 2; text = 'Brauchbar'; }
    else if (bits < 85) { stufe = 3; text = 'Gut'; }
    else { stufe = 4; text = 'Sehr gut'; }
    return { bits: bits, stufe: stufe, text: text };
  }

  /* ---------------------------------------------------------- Suche */

  function search(vaultData, query, catId, onlyFav, sortMode) {
    var q = String(query || '').trim().toLowerCase();
    var items = vaultData.items.filter(function (it) {
      if (it.deletedAt) { return false; }
      if (catId && it.cat !== catId) { return false; }
      if (onlyFav && !it.fav) { return false; }
      if (!q) { return true; }
      return (it.title + ' ' + it.url + ' ' + it.user + ' ' + it.note).toLowerCase().indexOf(q) >= 0;
    });
    sortieren(items, sortMode);
    return items;
  }

  function sortieren(items, sortMode) {
    if (sortMode === 'benutzt') {
      items.sort(function (a, b) {
        if (a.fav !== b.fav) { return a.fav ? -1 : 1; }
        var au = a.usedAt || '', bu = b.usedAt || '';
        if (au !== bu) { return au < bu ? 1 : -1; }
        return a.title.localeCompare(b.title, 'de', { sensitivity: 'base' });
      });
    } else if (sortMode === 'neu') {
      items.sort(function (a, b) {
        if (a.fav !== b.fav) { return a.fav ? -1 : 1; }
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
    } else {
      items.sort(function (a, b) {
        if (a.fav !== b.fav) { return a.fav ? -1 : 1; }
        return a.title.localeCompare(b.title, 'de', { sensitivity: 'base' });
      });
    }
    return items;
  }

  /* Alle im Papierkorb, jüngste zuerst. */
  function trashList(vaultData) {
    return vaultData.items.filter(function (it) { return !!it.deletedAt; })
      .sort(function (a, b) { return (b.deletedAt || '').localeCompare(a.deletedAt || ''); });
  }

  function liveCount(vaultData) {
    return vaultData.items.filter(function (it) { return !it.deletedAt; }).length;
  }

  /* ---------------------------------------------------------- Kassensturz
   *
   * Prüft die eigenen Passwörter gegen sich selbst. Kein Abgleich mit einer
   * Liste bekannter Lecks, denn dafür müsste man ins Netz, und das kommt nicht
   * in Frage. Was hier auffällt, fällt allein aus den Daten im Tresor auf:
   * mehrfach benutzte und rechnerisch schwache Passwörter.
   */
  function audit(vaultData) {
    var lebend = vaultData.items.filter(function (it) { return !it.deletedAt && it.pass; });

    var nachPass = Object.create(null);
    lebend.forEach(function (it) {
      var k = '#' + it.pass;
      (nachPass[k] = nachPass[k] || []).push(it);
    });
    var doppelt = [];
    Object.keys(nachPass).forEach(function (k) {
      if (nachPass[k].length > 1) { doppelt.push(nachPass[k].slice()); }
    });
    doppelt.sort(function (a, b) { return b.length - a.length; });

    var schwach = lebend.filter(function (it) { return ratePassword(it.pass).stufe <= 1; });
    schwach.sort(function (a, b) { return passwordBits(a.pass) - passwordBits(b.pass); });

    var betroffen = Object.create(null);
    doppelt.forEach(function (gr) { gr.forEach(function (it) { betroffen[it.id] = true; }); });
    schwach.forEach(function (it) { betroffen[it.id] = true; });

    var mitPass = lebend.length;
    var sauber = mitPass - Object.keys(betroffen).length;
    var note = mitPass === 0 ? 100 : Math.round(sauber / mitPass * 100);

    return {
      mitPasswort: mitPass,
      doppelt: doppelt,
      schwach: schwach,
      betroffen: Object.keys(betroffen).length,
      note: note
    };
  }

  /* -------------------------------------------------------------- CSV lesen */
  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    if (!text.trim()) { return []; }

    var ersteZeile = text.split(/\r?\n/)[0];
    var komma = 0, semi = 0, drin = false, i;
    for (i = 0; i < ersteZeile.length; i++) {
      var c = ersteZeile.charAt(i);
      if (c === '"') { drin = !drin; }
      else if (!drin && c === ',') { komma++; }
      else if (!drin && c === ';') { semi++; }
    }
    var trenner = semi > komma ? ';' : ',';

    var zeilen = [], feld = '', zeile = [], q = false;
    for (i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { feld += '"'; i++; }
          else { q = false; }
        } else { feld += ch; }
      } else if (ch === '"') { q = true; }
      else if (ch === trenner) { zeile.push(feld); feld = ''; }
      else if (ch === '\n') { zeile.push(feld); zeilen.push(zeile); feld = ''; zeile = []; }
      else if (ch === '\r') { /* weg */ }
      else { feld += ch; }
    }
    if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
    return zeilen.filter(function (z) { return z.some(function (f) { return f.trim() !== ''; }); });
  }

  var SPALTEN = {
    title: ['name', 'title', 'titel', 'account', 'entry', 'konto', 'bezeichnung'],
    url:   ['url', 'uri', 'login_uri', 'website', 'web site', 'webseite', 'address', 'adresse', 'location', 'link'],
    user:  ['username', 'user name', 'user', 'login', 'login_name', 'login_username', 'benutzer', 'benutzername', 'email', 'e-mail', 'mail'],
    pass:  ['password', 'passwort', 'kennwort', 'pass', 'pwd', 'login_password'],
    note:  ['notes', 'note', 'notiz', 'notizen', 'comment', 'comments', 'kommentar', 'bemerkung'],
    folder:['folder', 'group', 'gruppe', 'category', 'kategorie', 'ordner', 'sammlung']
  };

  function spalteFinden(kopf, feld) {
    for (var i = 0; i < kopf.length; i++) {
      var k = kopf[i].trim().toLowerCase();
      if (SPALTEN[feld].indexOf(k) >= 0) { return i; }
    }
    return -1;
  }

  function importCsv(text) {
    var zeilen = parseCsv(text);
    if (zeilen.length === 0) { return { items: [], categories: [], uebersprungen: 0, quelle: 'leer' }; }

    var kopf = zeilen[0];
    var map = { title: spalteFinden(kopf, 'title'), url: spalteFinden(kopf, 'url'),
                user: spalteFinden(kopf, 'user'), pass: spalteFinden(kopf, 'pass'),
                note: spalteFinden(kopf, 'note'), folder: spalteFinden(kopf, 'folder') };
    var hatKopf = map.title >= 0 || map.url >= 0 || map.user >= 0 || map.pass >= 0;

    var daten;
    if (hatKopf) { daten = zeilen.slice(1); }
    else { map = { title: 0, url: 1, user: 2, pass: 3, note: 4, folder: -1 }; daten = zeilen; }

    var hol = function (z, idx) { return idx >= 0 && idx < z.length ? String(z[idx] || '').trim() : ''; };

    var kategorien = Object.create(null);
    var items = [], uebersprungen = 0;

    daten.forEach(function (z) {
      var titel = hol(z, map.title), url = hol(z, map.url), user = hol(z, map.user),
          pass = hol(z, map.pass), note = hol(z, map.note), ordner = hol(z, map.folder);
      if (!titel && !url && !user && !pass) { uebersprungen++; return; }

      var catId = null;
      if (ordner) {
        var s = ordner.toLowerCase();
        if (!kategorien[s]) {
          kategorien[s] = newCategory(ordner, CATEGORY_COLORS[Object.keys(kategorien).length % CATEGORY_COLORS.length]);
        }
        catId = kategorien[s].id;
      }
      items.push(newItem({ title: titel || hostOf(url) || 'Ohne Titel', url: url, user: user, pass: pass, note: note, cat: catId }));
    });

    return {
      items: items,
      categories: Object.keys(kategorien).map(function (k) { return kategorien[k]; }),
      uebersprungen: uebersprungen,
      quelle: hatKopf ? 'mit Kopfzeile' : 'ohne Kopfzeile'
    };
  }

  /* ------------------------------------------------------ Lesezeichen lesen */
  function importBookmarks(html) {
    html = String(html || '');
    var items = [], kategorien = Object.create(null);

    var teile = html.split(/<DT>\s*<H3[^>]*>/i);
    var ordnerNamen = [null];
    var h3 = html.match(/<H3[^>]*>([\s\S]*?)<\/H3>/gi) || [];
    h3.forEach(function (m) { ordnerNamen.push(entHtml(m.replace(/<[^>]+>/g, '')).trim()); });

    teile.forEach(function (teil, idx) {
      var ordner = idx === 0 ? null : ordnerNamen[idx];
      var re = /<A\s[^>]*HREF\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/A>/gi, m;
      while ((m = re.exec(teil)) !== null) {
        var url = entHtml(m[1]).trim();
        var titel = entHtml(m[2].replace(/<[^>]+>/g, '')).trim();
        if (!safeUrl(url)) { continue; }

        var catId = null;
        if (ordner) {
          var s = ordner.toLowerCase();
          if (!kategorien[s]) {
            kategorien[s] = newCategory(ordner, CATEGORY_COLORS[Object.keys(kategorien).length % CATEGORY_COLORS.length]);
          }
          catId = kategorien[s].id;
        }
        items.push(newItem({ title: titel || hostOf(url) || url, url: url, cat: catId }));
      }
    });

    return {
      items: items,
      categories: Object.keys(kategorien).map(function (k) { return kategorien[k]; }),
      uebersprungen: 0,
      quelle: 'Lesezeichen'
    };
  }

  function entHtml(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /* Fügt ein Importergebnis ein. Dubletten (gleiche Adresse und gleicher
   * Benutzer) werden übersprungen, damit ein zweiter Import nichts verdoppelt. */
  function mergeImport(vaultData, ergebnis) {
    var vorhanden = Object.create(null);
    vaultData.items.forEach(function (it) {
      if (!it.deletedAt) { vorhanden['@' + (hostOf(it.url) + '|' + it.user).toLowerCase()] = true; }
    });

    var katMap = Object.create(null);
    var neueKat = 0, neueItems = 0, dubletten = 0;

    (ergebnis.categories || []).forEach(function (c) {
      var da = vaultData.categories.filter(function (x) { return x.name.toLowerCase() === c.name.toLowerCase(); })[0];
      if (da) { katMap[c.id] = da.id; }
      else { c.order = vaultData.categories.length; vaultData.categories.push(c); katMap[c.id] = c.id; neueKat++; }
    });

    (ergebnis.items || []).forEach(function (it) {
      var schluessel = '@' + (hostOf(it.url) + '|' + it.user).toLowerCase();
      if (it.url && vorhanden[schluessel]) { dubletten++; return; }
      if (it.cat && katMap[it.cat]) { it.cat = katMap[it.cat]; }
      vaultData.items.push(it);
      vorhanden[schluessel] = true;
      neueItems++;
    });

    return { neueItems: neueItems, neueKat: neueKat, dubletten: dubletten };
  }

  /* -------------------------------------------------------------- CSV schreiben
   * Ein Notausgang, kein Alltagswerkzeug. Klartext, gehört sofort gelöscht. */
  function exportCsv(vaultData) {
    var q = function (s) {
      s = String(s == null ? '' : s);
      return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var zeilen = ['name,url,username,password,notes,folder'];
    vaultData.items.filter(function (it) { return !it.deletedAt; }).forEach(function (it) {
      var cat = it.cat ? vaultData.categories.filter(function (c) { return c.id === it.cat; })[0] : null;
      zeilen.push([q(it.title), q(it.url), q(it.user), q(it.pass), q(it.note), q(cat ? cat.name : '')].join(','));
    });
    return zeilen.join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------- Merksatz-Generator
   *
   * Ein Passwort aus zufälligen Wörtern. Leichter zu merken als ein Wirrwarr
   * aus Zeichen und trotzdem stark, wenn es genug Wörter sind. Gedacht vor
   * allem für das Master-Passwort: das ist das einzige, das man sich merken
   * MUSS, denn es gibt keine Wiederherstellung.
   *
   * Die Liste sind gängige, kurze deutsche Wörter ohne Umlaute und ß, damit
   * sie sich überall leicht tippen lassen. Jedes Wort steuert log2(Anzahl)
   * Bit bei. Bei rund 300 Wörtern sind das gut 8 Bit je Wort.
   */
  var WORTLISTE = ('anker apfel abend acker adler affe ahorn akku alarm album ampel amsel angel anzug arbeit archiv armband auge auto baum beere berg besen biber birke blatt blitz blume boden bogen bohne braten brief brille brot bruecke buch buchse buegel buerste chef chor creme dach damm daumen decke degen delfin diele donner dorf dose drache draht dreieck duft duene eiche eimer eisen elch engel ente erbse esel eule fabrik faden fahne falke farbe faust feder feld fenster ferse fessel feuer fichte finger fisch flagge flamme flasche floss forelle frosch fuchs funke gabel garten gasse geige geist gemse giebel gipfel gitter glanz glocke gnom gold gras griff gruen gugel gummi hafen hahn haken halle hammer hand hase haube haus hebel heft heide helm hemd herd hering herz himmel hirsch hobel honig horn hose huegel huhn hund hut igel imker insel jacke jaeger jahr kabel kachel kaefer kai kamel kamin kanal kanne kappe karpfen karte kasten katze kegel kelle kerze kette kiefer kiel kies kirche kissen klee klinge knopf koffer kohle kolben komet korb kork kranz kreide kreis kruemel kufe kugel kunst kupfer kurbel lade lampe land laterne laub leder leine lenker leopard licht liga linde linse loewe loeffel luchs magnet mais mandel mantel mappe maske mast matte maus meer meise mensch messer metall milch moor moos motor muehle muschel nacht nadel nagel narbe nase nebel nelke nerz nest netz niere note nudel nuss ochse ofen ohr olive orgel otter paket palme panda papier pause pfad pfau pfeil pferd pflanze pilz pinsel pirat platte pol posaune pult puppe quader qualle quelle quitte rabe rad rahmen rakete rand raser ratte raute regal regen reh reifen riegel ring rippe robbe rohr rolle rose rost ruder rumpf runde saat sack saft salbe salz sand saum schacht schaf schal schere schiff schlange schluessel schnee schranke schwan see segel seife seil sichel sieb silber sofa sonne spange spatz specht speiche spiegel spinne spore stab stachel stamm stein stern stiel stock storch strand strasse strauch stuhl sturm tafel tanne tasche tasse taube teich teller tiger tinte tisch tomate tonne topf tor tresor trommel truhe tulpe turm ufer uhr ulme unke vase veilchen vogel volk waage wabe wald walnuss wange wanne ware wasser weg weide wein welle wende werk wespe weste wiese wimpel wind wippe wolke wolle wumme wurzel wuste zange zapfen zaun zebra zeder zeiger zelle zelt ziege ziegel zirkel zitrone zopf zug zwerg').split(' ');

  var _worte = null;
  function worte() {
    if (_worte) { return _worte; }
    var gesehen = Object.create(null), rein = [];
    WORTLISTE.forEach(function (w) {
      w = w.trim();
      if (w && !gesehen[w]) { gesehen[w] = true; rein.push(w); }
    });
    _worte = rein;
    return _worte;
  }

  function wortZahl() { return worte().length; }

  /* Ein zufälliges Element, gleichverteilt, ohne Modulo-Schiefstand. */
  function ausListe(liste) {
    requireSodium();
    var n = liste.length, limit = 4294967296 - (4294967296 % n);
    for (;;) {
      var b = sodium.randombytes_buf(4);
      var z = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
      if (z < limit) { return liste[z % n]; }
    }
  }

  function generatePassphrase(opts) {
    var o = opts || {};
    var anzahl = Math.max(3, Math.min(12, o.words || 6));
    var trenner = (typeof o.sep === 'string') ? o.sep : '-';
    var gross = o.caps !== false;         // Anfangsbuchstaben groß
    var zahl = o.zahl !== false;          // eine Zahl am Ende
    var liste = worte();

    var teile = [];
    for (var i = 0; i < anzahl; i++) {
      var w = ausListe(liste);
      if (gross) { w = w.charAt(0).toUpperCase() + w.slice(1); }
      teile.push(w);
    }
    var satz = teile.join(trenner);
    if (zahl) { satz += trenner + (10 + (sodium.randombytes_buf(1)[0] % 90)); }
    return satz;
  }

  /* Ehrliche Entropie eines Merksatzes: Wörter mal Bit je Wort, plus die Zahl. */
  function passphraseBits(opts) {
    var o = opts || {};
    var anzahl = Math.max(3, Math.min(12, o.words || 6));
    var proWort = Math.log(wortZahl()) / Math.log(2);
    var bits = anzahl * proWort;
    if (o.zahl !== false) { bits += Math.log(90) / Math.log(2); }
    return Math.round(bits);
  }

  /* --------------------------------------------------- Dubletten im Editor
   *
   * Gibt die anderen lebenden Einträge zurück, die dasselbe Passwort benutzen.
   * Damit kann die Bearbeitung warnen, bevor ein Passwort ein zweites Mal
   * vergeben wird. */
  function passwortAndernorts(vaultData, pass, ausserId) {
    if (!pass) { return []; }
    return vaultData.items.filter(function (it) {
      return !it.deletedAt && it.id !== ausserId && it.pass === pass;
    });
  }

  /* ------------------------------------------------------------ Einstellungen
   *
   * Pro Tresor gespeichert, damit sie überall gleich sind. Die Sperrzeit steuert
   * die Autosperre, die KDF-Stärke die nächste Speicherung. */
  var AUTO_LOCK_WERTE = [1, 5, 15, 30, 0];   // Minuten, 0 = nie

  function defaultSettings() {
    return { autoLockMin: 5, kdf: 'standard' };
  }

  function kdfVon(name) {
    if (name === 'sparsam') { return KDF_SPARSAM; }
    if (name === 'streng') { return { ops: 3, memKiB: 256 * 1024 }; }
    return KDF_DEFAULT;
  }

  function sanitizeSettings(roh) {
    var s = defaultSettings();
    if (roh && typeof roh === 'object') {
      if (AUTO_LOCK_WERTE.indexOf(roh.autoLockMin) >= 0) { s.autoLockMin = roh.autoLockMin; }
      if (['sparsam', 'standard', 'streng'].indexOf(roh.kdf) >= 0) { s.kdf = roh.kdf; }
    }
    return s;
  }

  /* ------------------------------------------------------------ Notfallzettel
   *
   * Der wichtigste Zettel im ganzen Projekt. Weil es keine Wiederherstellung
   * gibt, hängt der Zugang der Familie allein daran, dass jemand das Passwort
   * kennt und die Datei findet. Dieser Zettel wird ausgedruckt, das Passwort mit
   * der Hand eingetragen und zu den wichtigen Dokumenten gelegt.
   *
   * Er enthält NIE ein Passwort und keine Eintragsdaten. Nur den Namen des
   * Tresors, wo Programm und Datei liegen, und eine Anleitung für den Ernstfall.
   * Diese Funktion liefert nur die Textbausteine, das Aussehen macht die
   * Oberfläche.
   */
  function notfallText(vaultData, ort) {
    return {
      tresor: String(vaultData.name || 'Tresor'),
      datum: new Date().toLocaleDateString('de-AT', { day: '2-digit', month: 'long', year: 'numeric' }),
      programmOrt: String((ort && ort.programm) || ''),
      dateiOrt: String((ort && ort.datei) || ''),
      schritte: [
        'Die Datei PasswortPeter.html im Browser öffnen (Doppelklick).',
        'Die Tresordatei (endet auf .peter) in das Fenster ziehen.',
        'Das unten eingetragene Master-Passwort eingeben.'
      ],
      warnung: 'Es gibt keine Wiederherstellung. Ohne dieses Passwort ist der Tresor für immer verschlossen. Diesen Zettel wie ein wichtiges Dokument aufbewahren.'
    };
  }

  var api = {
    init: init,
    MAGIC: MAGIC,
    FORMAT_VERSION: FORMAT_VERSION,
    HEADER_LEN: HEADER_LEN,
    KDF_DEFAULT: KDF_DEFAULT,
    KDF_SPARSAM: KDF_SPARSAM,
    KDF_MIN: KDF_MIN,
    CATEGORY_COLORS: CATEGORY_COLORS,
    emptyVault: emptyVault,
    newCategory: newCategory,
    newItem: newItem,
    isBookmark: isBookmark,
    sanitize: sanitize,
    safeUrl: safeUrl,
    hostOf: hostOf,
    encrypt: encrypt,
    decrypt: decrypt,
    readHeader: readHeader,
    deriveKey: deriveKey,
    generatePassword: generatePassword,
    passwordBits: passwordBits,
    ratePassword: ratePassword,
    search: search,
    sortieren: sortieren,
    trashList: trashList,
    liveCount: liveCount,
    audit: audit,
    generatePassphrase: generatePassphrase,
    passphraseBits: passphraseBits,
    wortZahl: wortZahl,
    passwortAndernorts: passwortAndernorts,
    defaultSettings: defaultSettings,
    sanitizeSettings: sanitizeSettings,
    kdfVon: kdfVon,
    AUTO_LOCK_WERTE: AUTO_LOCK_WERTE,
    notfallText: notfallText,
    WORTLISTE: WORTLISTE,
    parseCsv: parseCsv,
    importCsv: importCsv,
    importBookmarks: importBookmarks,
    mergeImport: mergeImport,
    exportCsv: exportCsv,
    randomId: randomId,
    _utf8EncodeSelbst: utf8EncodeSelbst,
    _utf8DecodeSelbst: utf8DecodeSelbst
  };
  return api;
}));
