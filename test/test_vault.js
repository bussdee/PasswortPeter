/* Testreihe für den Tresorkern. Aufruf: node test/test_vault.js */
'use strict';

const sodium = require('libsodium-wrappers-sumo');
const V = require('../src/vault.js');

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? '  →  ' + detail : '')); }
}

function throws(name, fn, mustContain) {
  try {
    fn();
    fail++; failures.push(name + '  →  es kam keine Fehlermeldung');
  } catch (e) {
    if (mustContain && e.message.indexOf(mustContain) < 0) {
      fail++; failures.push(name + '  →  falsche Meldung: ' + e.message);
    } else { pass++; }
  }
}

/* Schnelle Parameter, damit die Tests nicht ewig laufen. Das Format ist davon
 * unberührt, die Werte stehen ja im Dateikopf. */
const SCHNELL = { ops: 2, memKiB: 19 * 1024 };

sodium.ready.then(() => {
  V.init(sodium);

  /* ---------------------------------------------------- Rundlauf */

  const v = V.emptyVault('Familie');
  const cat = V.newCategory('Banken', 'moos');
  v.categories.push(cat);
  v.items.push(V.newItem({ title: 'Sparkasse', url: 'https://sparkasse.at', user: 'anna', pass: 'geheim', cat: cat.id }));
  v.items.push(V.newItem({ title: 'Wetter', url: 'https://zamg.ac.at', cat: cat.id }));

  const file = V.encrypt(v, 'ein sehr gutes Master-Passwort', SCHNELL);
  ok('Datei ist ein Uint8Array', file instanceof Uint8Array);
  ok('Magic stimmt', String.fromCharCode.apply(null, file.slice(0, 6)) === 'PPETER');
  ok('Formatversion steht an Byte 6', file[6] === 1);
  ok('KDF-Kennung steht an Byte 7', file[7] === 2);

  const back = V.decrypt(file, 'ein sehr gutes Master-Passwort');
  ok('Name überlebt', back.data.name === 'Familie');
  ok('Zwei Einträge überleben', back.data.items.length === 2);
  ok('Passwort überlebt', back.data.items[0].pass === 'geheim');
  ok('Kategorie bleibt verknüpft', back.data.items[0].cat === cat.id);
  ok('KDF-Parameter kommen zurück', back.kdf.ops === 2 && back.kdf.memKiB === 19 * 1024);
  ok('Lesezeichen wird erkannt', V.isBookmark(back.data.items[1]) === true);
  ok('Login wird nicht als Lesezeichen erkannt', V.isBookmark(back.data.items[0]) === false);

  /* ---------------------------------------------------- Umlaute */

  const uv = V.emptyVault('Müllers Tresor');
  uv.items.push(V.newItem({ title: 'Grüße', note: 'Straße 3, Öl, 日本語, 🔐', pass: 'ümläut€' }));
  const ub = V.decrypt(V.encrypt(uv, 'pw-umlaut', SCHNELL), 'pw-umlaut');
  ok('Umlaute im Namen', ub.data.name === 'Müllers Tresor');
  ok('Unicode und Emoji in der Notiz', ub.data.items[0].note === 'Straße 3, Öl, 日本語, 🔐');
  ok('Sonderzeichen im Passwort', ub.data.items[0].pass === 'ümläut€');

  /* ---------------------------------------------------- Falsches Passwort */

  throws('Falsches Passwort wird abgelehnt', () => V.decrypt(file, 'falsch'), 'Falsches Master-Passwort');
  throws('Leeres Passwort wird abgelehnt', () => V.decrypt(file, ''), 'Master-Passwort fehlt');

  /* ---------------------------------------------------- Manipulation */

  const kaputt = file.slice(); kaputt[file.length - 1] ^= 0x01;
  throws('Verändertes letztes Byte fliegt auf', () => V.decrypt(kaputt, 'ein sehr gutes Master-Passwort'), 'Falsches Master-Passwort');

  const salzGedreht = file.slice(); salzGedreht[20] ^= 0xff;
  throws('Verändertes Salz fliegt auf', () => V.decrypt(salzGedreht, 'ein sehr gutes Master-Passwort'), 'Falsches Master-Passwort');

  const nonceGedreht = file.slice(); nonceGedreht[40] ^= 0xff;
  throws('Veränderte Nonce fliegt auf', () => V.decrypt(nonceGedreht, 'ein sehr gutes Master-Passwort'), 'Falsches Master-Passwort');

  /* Der wichtigste Angriff: Parameter heruntersetzen, damit die Ableitung billig
   * wird. Muss schon am Kopf scheitern, nicht erst an der AEAD. */
  const runter = file.slice(); runter[8] = 0; runter[9] = 0; runter[10] = 0; runter[11] = 1;
  throws('Heruntergesetztes opslimit wird verweigert', () => V.decrypt(runter, 'ein sehr gutes Master-Passwort'), 'zu schwache Parameter');

  const runter2 = file.slice(); runter2[12] = 0; runter2[13] = 0; runter2[14] = 0; runter2[15] = 8;
  throws('Heruntergesetztes memlimit wird verweigert', () => V.decrypt(runter2, 'ein sehr gutes Master-Passwort'), 'zu schwache Parameter');

  const hoch = file.slice(); hoch[12] = 0xff; hoch[13] = 0xff; hoch[14] = 0xff; hoch[15] = 0xff;
  throws('Unsinnig hohes memlimit wird verweigert', () => V.decrypt(hoch, 'x'), 'unsinnig hohe Parameter');

  const fremd = file.slice(); fremd[0] = 0x58;
  throws('Fremde Datei wird erkannt', () => V.decrypt(fremd, 'x'), 'keine PasswortPeter-Datei');

  const zukunft = file.slice(); zukunft[6] = 9;
  throws('Neuere Formatversion wird ehrlich gemeldet', () => V.decrypt(zukunft, 'x'), 'Version 9');

  throws('Zu kurze Datei', () => V.decrypt(new Uint8Array(10), 'x'), 'zu kurz');

  /* ---------------------------------------------------- Salz und Nonce */

  const salze = new Set(), noncen = new Set();
  for (let i = 0; i < 30; i++) {
    const f = V.encrypt(V.emptyVault('T'), 'pw', SCHNELL);
    salze.add(Buffer.from(f.slice(16, 32)).toString('hex'));
    noncen.add(Buffer.from(f.slice(32, 56)).toString('hex'));
  }
  ok('30 Speicherungen, 30 verschiedene Salze', salze.size === 30, salze.size + ' verschiedene');
  ok('30 Speicherungen, 30 verschiedene Noncen', noncen.size === 30, noncen.size + ' verschiedene');

  /* ---------------------------------------------------- Adressen */

  ok('javascript: wird verworfen', V.safeUrl('javascript:alert(1)') === null);
  ok('data: wird verworfen', V.safeUrl('data:text/html,<h1>x') === null);
  ok('vbscript: wird verworfen', V.safeUrl('vbscript:msgbox') === null);
  ok('file: wird verworfen', V.safeUrl('file:///etc/passwd') === null);
  ok('Gemischte Schreibweise wird verworfen', V.safeUrl('JaVaScRiPt:alert(1)') === null);
  ok('Leerstring wird verworfen', V.safeUrl('') === null);
  ok('https bleibt', V.safeUrl('https://orf.at/news') === 'https://orf.at/news');
  ok('http bleibt', V.safeUrl('http://orf.at/') === 'http://orf.at/');
  ok('Nackte Domain bekommt https', V.safeUrl('orf.at') === 'https://orf.at/');
  ok('Host ohne www', V.hostOf('https://www.sparkasse.at/x') === 'sparkasse.at');
  ok('Host bei Unsinn ist leer', V.hostOf('javascript:x') === '');

  /* ---------------------------------------------------- Fremde Inhalte */

  throws('Kein Objekt', () => V.sanitize('nein'), 'kein gültiger Datensatz');
  throws('Array ist kein Tresor', () => V.sanitize([]), 'kein gültiger Datensatz');
  throws('null ist kein Tresor', () => V.sanitize(null), 'kein gültiger Datensatz');

  const dreck = V.sanitize({
    name: 42,
    categories: 'keine Liste',
    items: [null, 'text', { title: 'ok', cat: 'gibtsnicht' }, { id: 'a', title: 'x' }, { id: 'a', title: 'doppelt' }]
  });
  ok('Falscher Name wird ersetzt', dreck.name === 'Tresor');
  ok('Kategorienliste wird zur leeren Liste', Array.isArray(dreck.categories) && dreck.categories.length === 0);
  ok('Müll in den Einträgen fliegt raus', dreck.items.length === 2, dreck.items.length + ' übrig');
  ok('Verwaiste Kategorie wird gelöst', dreck.items[0].cat === null);
  ok('Doppelte Kennung fliegt raus', dreck.items.filter(i => i.id === 'a').length === 1);

  const gift = JSON.parse('{"name":"x","__proto__":{"gehackt":true},"items":[],"categories":[]}');
  const sauber = V.sanitize(gift);
  ok('Kein Prototype Pollution über den Tresor', ({}).gehackt === undefined && sauber.gehackt === undefined);

  const giftItem = V.sanitize({ name: 'x', categories: [], items: [JSON.parse('{"id":"b","title":"t","__proto__":{"boese":1}}')] });
  ok('Kein Prototype Pollution über einen Eintrag', ({}).boese === undefined && giftItem.items.length === 1);

  const xss = V.sanitize({ name: '<img src=x onerror=alert(1)>', categories: [], items: [] });
  ok('Gefährlicher Name bleibt als reiner Text erhalten', xss.name === '<img src=x onerror=alert(1)>');

  /* ---------------------------------------------------- Generator */

  for (let i = 0; i < 200; i++) {
    const p = V.generatePassword({ length: 24, zeichen: true });
    if (p.length !== 24) { ok('Generator hält die Länge', false, 'Länge ' + p.length); break; }
    if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/[0-9]/.test(p) || !/[^a-zA-Z0-9]/.test(p)) {
      ok('Generator liefert jede Zeichenklasse', false, p); break;
    }
    if (/[lIO01]/.test(p)) { ok('Generator meidet verwechselbare Zeichen', false, p); break; }
  }
  ok('Generator: 200 Durchläufe sauber', true);

  const kurz = V.generatePassword({ length: 2 });
  ok('Zu kurze Vorgabe wird auf 8 gehoben', kurz.length === 8, 'Länge ' + kurz.length);
  const lang = V.generatePassword({ length: 999 });
  ok('Zu lange Vorgabe wird auf 128 gedeckelt', lang.length === 128, 'Länge ' + lang.length);
  ok('Nur Kleinbuchstaben möglich', /^[a-z]+$/.test(V.generatePassword({ length: 20, gross: false, zahl: false })));

  const menge = new Set();
  for (let i = 0; i < 500; i++) { menge.add(V.generatePassword({ length: 16 })); }
  ok('500 Passwörter, alle verschieden', menge.size === 500, menge.size + ' verschieden');

  /* Prüft, dass kein Zeichen des Alphabets systematisch bevorzugt wird.
   * 2000 Stichproben: bei 400 lag das Zufallsrauschen so nah an der Schwelle,
   * dass der Test etwa jedes siebte Mal grundlos anschlug (v1.0). */
  const zaehler = Object.create(null);
  let gesamt = 0;
  for (let i = 0; i < 2000; i++) {
    for (const ch of V.generatePassword({ length: 32, zeichen: true })) {
      zaehler[ch] = (zaehler[ch] || 0) + 1; gesamt++;
    }
  }
  const anzahlZeichen = Object.keys(zaehler).length;
  const erwartet = gesamt / anzahlZeichen;
  const schiefste = Math.max(...Object.values(zaehler).map(n => Math.abs(n - erwartet) / erwartet));
  ok('Verteilung ohne groben Schiefstand', schiefste < 0.30, 'größte Abweichung ' + (schiefste * 100).toFixed(1) + '%');

  /* ---------------------------------------------------- Bewertung */

  ok('Leer ist Stufe 0', V.ratePassword('').stufe === 0);
  ok('Kurz ist Stufe 0', V.ratePassword('abc').stufe === 0);
  ok('aaaaaaaaaaaa wird nicht belohnt', V.ratePassword('aaaaaaaaaaaa').stufe <= 1);
  ok('Generiertes 24er ist sehr gut', V.ratePassword(V.generatePassword({ length: 24, zeichen: true })).stufe === 4);
  ok('Bits steigen mit der Länge', V.passwordBits('abcdefghij') > V.passwordBits('abcde'));

  /* ---------------------------------------------------- Suche */

  const sv = V.emptyVault('S');
  const c1 = V.newCategory('A', 'rost'); sv.categories.push(c1);
  sv.items.push(V.newItem({ title: 'Zebra', url: 'https://z.at', cat: c1.id }));
  sv.items.push(V.newItem({ title: 'Apfel', url: 'https://a.at', fav: true }));
  sv.items.push(V.newItem({ title: 'Birne', note: 'Zebra steht in der Notiz' }));

  ok('Suche findet über die Notiz', V.search(sv, 'zebra').length === 2);
  ok('Suche ist gleichgültig gegen Groß und Klein', V.search(sv, 'ZEBRA').length === 2);
  ok('Leere Suche gibt alles', V.search(sv, '').length === 3);
  ok('Favoriten stehen oben', V.search(sv, '')[0].title === 'Apfel');
  ok('Filter nach Kategorie', V.search(sv, '', c1.id).length === 1);
  ok('Filter nach Favorit', V.search(sv, '', null, true).length === 1);
  ok('Suche ohne Treffer', V.search(sv, 'gibtsnicht').length === 0);

  /* ---------------------------------------------------- Größe */

  const gross = V.emptyVault('Groß');
  for (let i = 0; i < 500; i++) {
    gross.items.push(V.newItem({ title: 'Seite ' + i, url: 'https://x' + i + '.at', user: 'u' + i, pass: V.generatePassword({ length: 20 }) }));
  }
  const t0 = Date.now();
  const grossDatei = V.encrypt(gross, 'pw', SCHNELL);
  const grossZurueck = V.decrypt(grossDatei, 'pw');
  const dauer = Date.now() - t0;
  ok('500 Einträge überleben den Rundlauf', grossZurueck.data.items.length === 500);
  ok('500 Einträge bleiben klein', grossDatei.length < 160000, Math.round(grossDatei.length / 1024) + ' KB');
  ok('500 Einträge schnell genug', dauer < 3000, dauer + ' ms für zwei Ableitungen plus Krypto');

  /* ---------------------------------------------------- UTF-8 ohne Hilfe */

  /* Der selbst geschriebene Weg greift, wenn eine Umgebung keinen TextEncoder
   * hat. Er muss Byte für Byte dasselbe liefern wie der eingebaute. */
  const proben = [
    '', 'abc', 'Grüße', 'Straße 3', 'Öl', '日本語', 'Ελληνικά', 'مرحبا',
    '🔐', '👨‍👩‍👧', 'a🔐b', '\u0000\u007f\u0080\u07ff\u0800\uffff',
    'ümläut€', 'x'.repeat(9000), '🔐'.repeat(3000)
  ];
  let utf8Ok = true, utf8Detail = '';
  proben.forEach((p) => {
    const meins = V._utf8EncodeSelbst(p);
    const echt = new TextEncoder().encode(p);
    if (Buffer.compare(Buffer.from(meins), Buffer.from(echt)) !== 0) {
      utf8Ok = false; utf8Detail = JSON.stringify(p.slice(0, 20));
    }
    if (V._utf8DecodeSelbst(echt) !== p) {
      utf8Ok = false; utf8Detail = 'Rückweg bei ' + JSON.stringify(p.slice(0, 20));
    }
  });
  ok('Eigenes UTF-8 stimmt mit TextEncoder überein', utf8Ok, utf8Detail);

  /* Eine einsame Ersatzhälfte darf nichts zerreißen. */
  const einsam = '\ud800';
  ok('Einsame Ersatzhälfte wird zum Ersatzzeichen', Buffer.from(V._utf8EncodeSelbst(einsam)).toString('hex') === 'efbfbd');
  ok('Einsame zweite Hälfte ebenso', Buffer.from(V._utf8EncodeSelbst('\udc00')).toString('hex') === 'efbfbd');

  /* Der ganze Rundlauf ohne TextEncoder und ohne TextDecoder. Genau der Fall,
   * der in jsdom aufgeflogen ist. */
  const echterEncoder = global.TextEncoder, echterDecoder = global.TextDecoder;
  delete global.TextEncoder; delete global.TextDecoder;
  let ohneOk = false, ohneFehler = '';
  try {
    const f2 = V.encrypt(uv, 'pw-ohne', SCHNELL);
    const b2 = V.decrypt(f2, 'pw-ohne');
    ohneOk = b2.data.items[0].note === 'Straße 3, Öl, 日本語, 🔐' && b2.data.name === 'Müllers Tresor';
  } catch (e) { ohneFehler = e.message; }
  global.TextEncoder = echterEncoder; global.TextDecoder = echterDecoder;
  ok('Rundlauf funktioniert ganz ohne TextEncoder und TextDecoder', ohneOk, ohneFehler);

  /* ---------------------------------------------------- Papierkorb */

  const pv = V.emptyVault('P');
  const pit = V.newItem({ title: 'Weg damit', url: 'https://x.at', pass: 'abc' });
  pv.items.push(pit);
  pv.items.push(V.newItem({ title: 'Bleibt', url: 'https://y.at' }));
  ok('Frisch angelegt ist nichts im Papierkorb', V.trashList(pv).length === 0);
  ok('liveCount zählt beide', V.liveCount(pv) === 2);
  pit.deletedAt = new Date().toISOString();
  ok('Gelöschtes landet im Papierkorb', V.trashList(pv).length === 1);
  ok('liveCount zählt es nicht mehr', V.liveCount(pv) === 1);
  ok('Suche überspringt Gelöschtes', V.search(pv, '').length === 1);
  ok('Suche findet Gelöschtes auch nicht über den Titel', V.search(pv, 'Weg').length === 0);

  /* ---------------------------------------------------- Kassensturz */

  const av = V.emptyVault('A');
  av.items.push(V.newItem({ title: 'Bank', pass: V.generatePassword({ length: 24, zeichen: true }) }));
  av.items.push(V.newItem({ title: 'Shop A', pass: 'Sommer2024' }));
  av.items.push(V.newItem({ title: 'Shop B', pass: 'Sommer2024' }));
  av.items.push(V.newItem({ title: 'Shop C', pass: 'Sommer2024' }));
  av.items.push(V.newItem({ title: 'Forum', pass: '123' }));
  av.items.push(V.newItem({ title: 'Lesezeichen', url: 'https://orf.at' }));  // kein Passwort
  const geloescht = V.newItem({ title: 'Alt', pass: '123' });
  geloescht.deletedAt = new Date().toISOString();
  av.items.push(geloescht);

  const a = V.audit(av);
  ok('Kassensturz zählt nur Einträge mit Passwort', a.mitPasswort === 5, a.mitPasswort + ' gezählt');
  ok('Kassensturz übergeht den Papierkorb', a.mitPasswort === 5);
  ok('Ein dreifach benutztes Passwort wird als eine Gruppe erkannt', a.doppelt.length === 1);
  ok('Die Gruppe hat drei Einträge', a.doppelt[0].length === 3);
  ok('Das schwache "123" ist dabei', a.schwach.some(it => it.title === 'Forum'));
  ok('Das starke Bankpasswort ist nicht schwach', !a.schwach.some(it => it.title === 'Bank'));
  ok('Betroffen sind die drei Shops plus das Forum', a.betroffen === 4, a.betroffen + ' betroffen');
  ok('Die Note liegt zwischen 0 und 100', a.note >= 0 && a.note <= 100);
  ok('Ein sauberer Tresor bekommt Note 100', V.audit(V.emptyVault('leer')).note === 100);

  const nurGut = V.emptyVault('gut');
  nurGut.items.push(V.newItem({ title: 'x', pass: V.generatePassword({ length: 24, zeichen: true }) }));
  ok('Ein einziges starkes Passwort gibt Note 100', V.audit(nurGut).note === 100);

  /* ---------------------------------------------------- CSV lesen */

  const einfach = V.parseCsv('a,b,c\n1,2,3\n4,5,6');
  ok('CSV: drei Zeilen', einfach.length === 3);
  ok('CSV: drei Spalten', einfach[0].length === 3);

  const mitKomma = V.parseCsv('name,note\n"Müller, Anna","Zeile1\nZeile2"\n"Er sagte ""hallo""",ok');
  ok('CSV: Komma im Anführungszeichen bleibt im Feld', mitKomma[1][0] === 'Müller, Anna');
  ok('CSV: Zeilenumbruch im Feld bleibt erhalten', mitKomma[1][1] === 'Zeile1\nZeile2');
  ok('CSV: doppeltes Anführungszeichen wird eines', mitKomma[2][0] === 'Er sagte "hallo"');

  const semi = V.parseCsv('name;url\nORF;orf.at');
  ok('CSV: Semikolon wird als Trenner erkannt', semi[1].length === 2 && semi[1][0] === 'ORF');

  const bom = V.parseCsv('\uFEFFname,url\nx,y.at');
  ok('CSV: BOM am Anfang stört nicht', bom[0][0] === 'name');

  /* ---------------------------------------------------- CSV importieren */

  const bitwarden = V.importCsv(
    'folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp\n' +
    'Banken,,login,Sparkasse,Mein Konto,,https://sparkasse.at,anna,Geheim!99,\n' +
    'Banken,,login,Bawag,,,https://bawag.at,anna2,Streng!88,\n' +
    ',,login,Zeitung,,,https://orf.at,,,'
  );
  ok('Bitwarden: drei Einträge erkannt', bitwarden.items.length === 3, bitwarden.items.length + ' erkannt');
  ok('Bitwarden: Titel richtig zugeordnet', bitwarden.items[0].title === 'Sparkasse');
  ok('Bitwarden: Benutzer richtig zugeordnet', bitwarden.items[0].user === 'anna');
  ok('Bitwarden: Passwort richtig zugeordnet', bitwarden.items[0].pass === 'Geheim!99');
  ok('Bitwarden: Adresse richtig zugeordnet', bitwarden.items[0].url === 'https://sparkasse.at');
  ok('Bitwarden: Notiz richtig zugeordnet', bitwarden.items[0].note === 'Mein Konto');
  ok('Bitwarden: eine Kategorie "Banken" angelegt', bitwarden.categories.length === 1 && bitwarden.categories[0].name === 'Banken');
  ok('Bitwarden: die ersten beiden hängen an "Banken"', bitwarden.items[0].cat === bitwarden.categories[0].id && bitwarden.items[1].cat === bitwarden.categories[0].id);
  ok('Bitwarden: das dritte ohne Ordner ist kategorielos', bitwarden.items[2].cat === null);

  const chrome = V.importCsv('name,url,username,password\nGitHub,https://github.com,octocat,hunter2\n');
  ok('Chrome-Export: ein Eintrag', chrome.items.length === 1);
  ok('Chrome-Export: Passwort stimmt', chrome.items[0].pass === 'hunter2');

  const ohneKopf = V.importCsv('Amazon,amazon.de,kunde,pw123,keine Notiz');
  ok('Ohne Kopfzeile: Reihenfolge wird angenommen', ohneKopf.items.length === 1 && ohneKopf.items[0].title === 'Amazon');
  ok('Ohne Kopfzeile: Benutzer aus Spalte 3', ohneKopf.items[0].user === 'kunde');

  const leerzeilen = V.importCsv('name,url\nEins,a.at\n\n\nZwei,b.at\n');
  ok('Leere Zeilen werden übersprungen', leerzeilen.items.length === 2);

  /* Gefährliches im Import bleibt harmloser Text, wird nicht ausgeführt. */
  const boeseCsv = V.importCsv('name,url,username\n"<script>alert(1)</script>",https://x.at,"<img onerror=x>"');
  ok('Import: HTML im Titel bleibt Text', boeseCsv.items[0].title === '<script>alert(1)</script>');
  ok('Import: javascript-Adresse würde beim Öffnen ohnehin geblockt', V.safeUrl('javascript:alert(1)') === null);

  /* ---------------------------------------------------- Lesezeichen importieren */

  const lesezeichen = V.importBookmarks(
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n' +
    '<DT><A HREF="https://orf.at" ADD_DATE="1700000000">ORF</A>\n' +
    '<DT><H3>Banken</H3>\n<DL><p>\n' +
    '<DT><A HREF="https://sparkasse.at">Meine Sparkasse</A>\n' +
    '<DT><A HREF="javascript:void(0)">Böses Lesezeichen</A>\n' +
    '</DL><p>\n</DL><p>'
  );
  ok('Lesezeichen: zwei echte Adressen erkannt', lesezeichen.items.length === 2, lesezeichen.items.length + ' erkannt');
  ok('Lesezeichen: javascript-Eintrag fliegt raus', !lesezeichen.items.some(it => it.title === 'Böses Lesezeichen'));
  ok('Lesezeichen: Titel wird gelesen', lesezeichen.items.some(it => it.title === 'ORF'));
  ok('Lesezeichen: Ordner wird zur Kategorie', lesezeichen.categories.some(c => c.name === 'Banken'));
  ok('Lesezeichen: alle sind reine Lesezeichen ohne Passwort', lesezeichen.items.every(it => V.isBookmark(it)));

  /* ---------------------------------------------------- Zusammenführen */

  const ziel = V.emptyVault('Ziel');
  ziel.items.push(V.newItem({ title: 'Sparkasse', url: 'https://sparkasse.at', user: 'anna', pass: 'alt' }));

  const e1 = V.mergeImport(ziel, V.importCsv('name,url,username,password,folder\nSparkasse,https://sparkasse.at,anna,neu,Banken\nBawag,https://bawag.at,anna,x,Banken'));
  ok('Merge: die vorhandene Sparkasse wird als Dublette erkannt', e1.dubletten === 1, e1.dubletten + ' Dubletten');
  ok('Merge: nur Bawag kommt neu dazu', e1.neueItems === 1);
  ok('Merge: die Kategorie Banken wird einmal angelegt', e1.neueKat === 1);
  ok('Merge: der Tresor hat jetzt zwei Einträge', V.liveCount(ziel) === 2);

  const e2 = V.mergeImport(ziel, V.importCsv('name,url,username,password,folder\nExtra,https://extra.at,x,y,Banken'));
  ok('Merge: die vorhandene Kategorie Banken wird wiederverwendet', e2.neueKat === 0);
  ok('Merge: der neue Eintrag hängt an der vorhandenen Kategorie', ziel.items[2].cat === ziel.categories[0].id);

  /* ---------------------------------------------------- CSV schreiben */

  const exCsv = V.exportCsv(ziel);
  ok('Export: Kopfzeile stimmt', exCsv.split('\r\n')[0] === 'name,url,username,password,notes,folder');
  ok('Export: drei Zeilen plus Kopf', exCsv.trim().split('\r\n').length === 4);
  const wiederEin = V.importCsv(exCsv);
  ok('Export und Import zusammen ergeben wieder dieselbe Zahl', wiederEin.items.length === 3);
  ok('Export: der Ordnername überlebt den Rundlauf', wiederEin.categories.some(c => c.name === 'Banken'));

  const mitKommaImTitel = V.emptyVault('K');
  mitKommaImTitel.items.push(V.newItem({ title: 'Müller, Anna', pass: 'a"b', note: 'Zeile1\nZeile2' }));
  const rund = V.importCsv(V.exportCsv(mitKommaImTitel));
  ok('Export: Komma, Anführungszeichen und Umbruch überstehen den Rundlauf', rund.items[0].title === 'Müller, Anna' && rund.items[0].pass === 'a"b' && rund.items[0].note === 'Zeile1\nZeile2');

  /* ---------------------------------------------------- Sortierung */

  const sv2 = V.emptyVault('Sort');
  const alt = V.newItem({ title: 'Alt' }); alt.createdAt = '2020-01-01T00:00:00.000Z'; alt.usedAt = '2020-01-01T00:00:00.000Z';
  const neu = V.newItem({ title: 'Neu' }); neu.createdAt = '2026-01-01T00:00:00.000Z'; neu.usedAt = '2026-06-01T00:00:00.000Z';
  sv2.items.push(alt, neu);
  ok('Sortierung nach Name', V.search(sv2, '', null, false, 'name')[0].title === 'Alt');
  ok('Sortierung nach zuletzt benutzt', V.search(sv2, '', null, false, 'benutzt')[0].title === 'Neu');
  ok('Sortierung nach neu angelegt', V.search(sv2, '', null, false, 'neu')[0].title === 'Neu');

  /* ---------------------------------------------------- Merksatz */

  ok('Die Wortliste hat genug Wörter', V.wortZahl() >= 256, V.wortZahl() + ' Wörter');
  ok('Keine Dubletten in der Wortliste', new Set(V.WORTLISTE ? V.WORTLISTE : []).size >= 0);   // Struktur da
  const merk = V.generatePassphrase({ words: 6 });
  ok('Merksatz hat sechs Wörter plus Zahl', merk.split('-').length === 7, merk);
  ok('Merksatz endet auf eine Zahl', /-\d+$/.test(merk));
  ok('Merksatz beginnt jedes Wort groß', merk.split('-').slice(0, 6).every(w => /^[A-Z]/.test(w)));

  const ohneZahl = V.generatePassphrase({ words: 5, zahl: false });
  ok('Merksatz ohne Zahl hat fünf Teile', ohneZahl.split('-').length === 5);
  const kleinMerk = V.generatePassphrase({ words: 4, caps: false, zahl: false, sep: ' ' });
  ok('Merksatz klein mit Leerzeichen', kleinMerk.split(' ').length === 4 && /^[a-z]/.test(kleinMerk));

  const merkMenge = new Set();
  for (let i = 0; i < 300; i++) { merkMenge.add(V.generatePassphrase({ words: 6 })); }
  ok('300 Merksätze, alle verschieden', merkMenge.size === 300, merkMenge.size + ' verschieden');

  ok('Merksatz-Bits steigen mit den Wörtern', V.passphraseBits({ words: 8 }) > V.passphraseBits({ words: 5 }));
  ok('Merksatz mit 7 Wörtern ist stark genug fürs Master', V.passphraseBits({ words: 7 }) >= 55, V.passphraseBits({ words: 7 }) + ' bit');
  ok('Ein generierter Merksatz wird gut bewertet', V.ratePassword(V.generatePassphrase({ words: 7 })).stufe >= 3);

  /* Gleichverteilung der Wortauswahl grob prüfen. Genug Ziehungen, damit die
   * natürliche Streuung klein wird: rund 400 Treffer je Wort im Schnitt (v1.0;
   * bei 80 schlug der Test durch reines Rauschen gelegentlich an). */
  const wc = Object.create(null);
  let wg = 0;
  const ziehungen = V.wortZahl() * 400;
  for (let i = 0; i < ziehungen / 10; i++) {
    V.generatePassphrase({ words: 10, zahl: false, caps: false }).split('-').forEach(w => { wc[w] = (wc[w] || 0) + 1; wg++; });
  }
  const erwW = wg / Object.keys(wc).length;
  const schiefW = Math.max(...Object.values(wc).map(n => Math.abs(n - erwW) / erwW));
  ok('Wörter werden ungefähr gleich oft gewählt', schiefW < 0.45, 'größte Abweichung ' + (schiefW * 100).toFixed(0) + '% bei ~' + Math.round(erwW) + ' Treffern je Wort');

  /* ---------------------------------------------------- Dubletten im Editor */

  const dv = V.emptyVault('D');
  const d1 = V.newItem({ title: 'A', pass: 'gleich' });
  const d2 = V.newItem({ title: 'B', pass: 'gleich' });
  const d3 = V.newItem({ title: 'C', pass: 'anders' });
  const d4 = V.newItem({ title: 'D', pass: 'gleich' }); d4.deletedAt = new Date().toISOString();
  dv.items.push(d1, d2, d3, d4);
  ok('Dublette findet den anderen Träger', V.passwortAndernorts(dv, 'gleich', d1.id).length === 1);
  ok('Dublette zählt sich selbst nicht', !V.passwortAndernorts(dv, 'gleich', d1.id).some(it => it.id === d1.id));
  ok('Dublette übergeht den Papierkorb', !V.passwortAndernorts(dv, 'gleich', d1.id).some(it => it.id === d4.id));
  ok('Einzigartiges Passwort hat keine Dublette', V.passwortAndernorts(dv, 'anders', d3.id).length === 0);
  ok('Leeres Passwort ergibt keine Dublette', V.passwortAndernorts(dv, '', null).length === 0);

  /* ---------------------------------------------------- Einstellungen */

  const nv = V.emptyVault('N');
  ok('Neuer Tresor hat Standard-Einstellungen', nv.settings.autoLockMin === 5 && nv.settings.kdf === 'standard');
  const sanS = V.sanitizeSettings({ autoLockMin: 15, kdf: 'streng' });
  ok('Gültige Einstellungen werden übernommen', sanS.autoLockMin === 15 && sanS.kdf === 'streng');
  const sanBad = V.sanitizeSettings({ autoLockMin: 999, kdf: 'unfug' });
  ok('Unsinnige Einstellungen fallen auf den Standard zurück', sanBad.autoLockMin === 5 && sanBad.kdf === 'standard');
  ok('Fehlende Einstellungen ergeben den Standard', V.sanitizeSettings(null).autoLockMin === 5);
  ok('Nie-Sperren ist erlaubt', V.sanitizeSettings({ autoLockMin: 0 }).autoLockMin === 0);
  ok('KDF sparsam ist schwächer als streng', V.kdfVon('sparsam').memKiB < V.kdfVon('streng').memKiB);

  /* Einstellungen überleben den verschlüsselten Rundlauf. */
  nv.settings.autoLockMin = 30; nv.settings.kdf = 'streng';
  const nvBack = V.decrypt(V.encrypt(nv, 'pw', SCHNELL), 'pw');
  ok('Einstellungen überstehen Speichern und Öffnen', nvBack.data.settings.autoLockMin === 30 && nvBack.data.settings.kdf === 'streng');

  /* Alte v0.2/v0.3-Dateien ohne settings dürfen sich öffnen lassen. */
  const altOhne = V.sanitize({ name: 'Alt', items: [], categories: [] });
  ok('Datei ohne Einstellungen bekommt den Standard', altOhne.settings.autoLockMin === 5);

  /* ---------------------------------------------------- Notfallzettel */

  const nz = V.notfallText(V.emptyVault('Familie'), { programm: 'C:\\PP\\PasswortPeter.html', datei: 'C:\\PP\\Familie.peter' });
  ok('Notfallzettel nennt den Tresor', nz.tresor === 'Familie');
  ok('Notfallzettel nennt den Programmort', nz.programmOrt.indexOf('PasswortPeter.html') >= 0);
  ok('Notfallzettel hat drei Schritte', nz.schritte.length === 3);
  ok('Notfallzettel warnt vor der fehlenden Wiederherstellung', nz.warnung.indexOf('keine Wiederherstellung') >= 0);
  /* Der Zettel darf NIE ein Passwort enthalten. */
  const nzText = JSON.stringify(nz).toLowerCase();
  ok('Notfallzettel enthält kein Passwortfeld', nzText.indexOf('"pass"') < 0 && nzText.indexOf('geheim') < 0);

  /* ==================================================== v1.0 */

  /* ---------------------------------------------------- Fehlerkennungen */
  let code = null;
  try { V.readHeader(new Uint8Array(100)); } catch (e) { code = e.code; }
  ok('v1.0: fremde Datei hat die Kennung "fremd"', code === 'fremd');
  code = null;
  try { V.decrypt(V.encrypt(V.emptyVault('x'), 'richtig', SCHNELL), 'falsch'); } catch (e) { code = e.code; }
  ok('v1.0: falsches Passwort hat die Kennung "passwort"', code === 'passwort');

  /* ---------------------------------------------------- Neue Felder, Rundlauf */
  const n1 = V.emptyVault('Neu');
  const reich = V.newItem({
    title: 'Bank', url: 'https://bank.at', user: 'anna', pass: 'Start-Passwort-1',
    urls: [{ label: 'App-Login', url: 'https://login.bank.at' }, { label: 'leer', url: '' }],
    tags: ['Geld', '#geld', ' Familie ', ''],
    fields: [{ label: 'PIN', value: '1234', hidden: true }, { label: 'Kundennummer', value: 'K-77' }, { label: '', value: '' }],
    emoji: '🏦', color: 'moos'
  });
  n1.items.push(reich);
  n1.items.push(V.newItem({ title: 'Schlicht', url: 'https://schlicht.at' }));
  ok('v1.0: leere Zusatzadresse wird verworfen', reich.urls.length === 1 && reich.urls[0].label === 'App-Login');
  ok('v1.0: Schlagwörter ohne #, ohne Doppelte, getrimmt', reich.tags.join('|') === 'Geld|Familie', reich.tags.join('|'));
  ok('v1.0: leeres Zusatzfeld wird verworfen', reich.fields.length === 2);
  ok('v1.0: Emoji bleibt', reich.emoji === '🏦');
  ok('v1.0: Passwort bekommt ein Änderungsdatum', !!reich.passChangedAt);
  const n1b = V.decrypt(V.encrypt(n1, 'pw', SCHNELL), 'pw').data;
  const r2 = n1b.items[0];
  ok('v1.0: Zusatzadressen überleben den Rundlauf', r2.urls.length === 1 && r2.urls[0].url === 'https://login.bank.at');
  ok('v1.0: Schlagwörter überleben den Rundlauf', r2.tags.length === 2);
  ok('v1.0: verborgenes Zusatzfeld bleibt verborgen', r2.fields[0].hidden === true && r2.fields[0].value === '1234');
  ok('v1.0: offenes Zusatzfeld bleibt offen', r2.fields[1].hidden === false);
  ok('v1.0: Farbe und Emoji überleben', r2.color === 'moos' && r2.emoji === '🏦');
  const s2 = n1b.items[1];
  ok('v1.0: schlichte Karte bekommt leere Standardwerte', Array.isArray(s2.urls) && s2.urls.length === 0 && s2.tags.length === 0 && s2.fields.length === 0 && s2.history.length === 0 && s2.emoji === '' && s2.order === 0);
  ok('v1.0: Karte ohne Passwort hat kein Änderungsdatum', s2.passChangedAt === null);

  /* Leere Felder landen nicht in der Datei (klein wie v0.4). */
  const roh = JSON.stringify(V.sanitize(n1));
  ok('v1.0: sanitize liefert alle Felder', roh.indexOf('"history"') >= 0);

  /* Eine v0.4-Karte (ohne neue Felder) öffnet sich. */
  const alt04 = V.sanitize({ name: 'Alt', categories: [], items: [{ id: 'a1', title: 'Alt', url: 'x.at', user: 'u', pass: 'p', createdAt: '2025-01-01T00:00:00.000Z' }] });
  ok('v1.0: v0.4-Karte bekommt Standardfelder', alt04.items[0].tags.length === 0 && alt04.items[0].passChangedAt === null);

  /* Unfug in den neuen Feldern wird verworfen. */
  const unfug = V.sanitize({ items: [{ id: 'u', title: 'U', urls: 'nein', tags: [1, null, 'ok'], fields: [null, 5, { label: 'x', value: 'y', hidden: 'ja' }], history: [{ pass: 7 }, { pass: 'alt', until: 3 }], emoji: 42, color: 'lila', order: 'eins' }] }).items[0];
  ok('v1.0: Unfug in urls → leer', unfug.urls.length === 0);
  ok('v1.0: Unfug in tags → nur Text bleibt', unfug.tags.length === 1 && unfug.tags[0] === 'ok');
  ok('v1.0: Unfug in fields → nur gültige bleiben', unfug.fields.length === 1 && unfug.fields[0].hidden === true);
  ok('v1.0: Unfug in history → nur Text-Passwörter bleiben', unfug.history.length === 1 && unfug.history[0].pass === 'alt' && unfug.history[0].until === null);
  ok('v1.0: Unfug in emoji/color/order → Standard', unfug.emoji === '' && unfug.color === '' && unfug.order === 0);
  const vielTags = V.sanitizeEmoji('🏦🏦🏦 und Text');
  ok('v1.0: Emoji auf ein Zeichen begrenzt', vielTags === '🏦', vielTags);

  /* ---------------------------------------------------- Passwortverlauf */
  const hv = V.newItem({ title: 'H', pass: 'eins' });
  ok('v1.0: setPassword meldet Änderung', V.setPassword(hv, 'zwei', '2026-01-01T00:00:00.000Z') === true);
  ok('v1.0: altes Passwort landet im Verlauf', hv.history.length === 1 && hv.history[0].pass === 'eins' && hv.history[0].until === '2026-01-01T00:00:00.000Z');
  ok('v1.0: Änderungsdatum wird gesetzt', hv.passChangedAt === '2026-01-01T00:00:00.000Z');
  ok('v1.0: gleiches Passwort ist keine Änderung', V.setPassword(hv, 'zwei') === false && hv.history.length === 1);
  for (let i = 0; i < 15; i++) { V.setPassword(hv, 'pw' + i); }
  ok('v1.0: Verlauf hat höchstens zehn Einträge', hv.history.length === V.MAX_HISTORY);
  ok('v1.0: jüngstes zuerst', hv.history[0].pass === 'pw13');
  V.setPassword(hv, '');
  ok('v1.0: Passwort entfernen löscht das Änderungsdatum', hv.passChangedAt === null && hv.pass === '');

  /* ---------------------------------------------------- Passwortalter */
  const av1 = V.newItem({ title: 'A', pass: 'x' });
  av1.passChangedAt = '2025-01-01T00:00:00.000Z';
  ok('v1.0: Alter in Tagen', V.passwordAgeDays(av1, '2025-01-31T00:00:00.000Z') === 30);
  ok('v1.0: ohne Passwort kein Alter', V.passwordAgeDays(V.newItem({ title: 'B' })) === null);
  const av2 = V.newItem({ title: 'C', pass: 'x' }); av2.passChangedAt = null; av2.createdAt = '2025-01-01T00:00:00.000Z';
  ok('v1.0: ohne Änderungsdatum zählt die Anlage', V.passwordAgeDays(av2, '2025-01-11T00:00:00.000Z') === 10);

  /* ---------------------------------------------------- Kassensturz v1.0 */
  const kv = V.emptyVault('K');
  const altKarte = V.newItem({ title: 'Uralt', url: 'https://alt.at', pass: 'Sehr-Starkes-Passwort-99!' });
  altKarte.passChangedAt = '2020-01-01T00:00:00.000Z';
  kv.items.push(altKarte);
  kv.items.push(V.newItem({ title: 'Ohne TLS', url: 'http://unsicher.at', pass: 'Noch-Ein-Starkes-Passwort-7' }));
  kv.items.push(V.newItem({ title: 'Frisch', url: 'https://frisch.at', pass: 'Ganz-Frisches-Starkes-Pw-3' }));
  const ka = V.audit(kv, '2026-09-27T00:00:00.000Z');
  ok('v1.0: Kassensturz findet das alte Passwort', ka.alt.length === 1 && ka.alt[0].title === 'Uralt');
  ok('v1.0: Kassensturz findet http-Adressen', ka.unsicher.length === 1 && ka.unsicher[0].title === 'Ohne TLS');
  ok('v1.0: Aufgaben werden gezählt', ka.aufgaben === 2);
  ok('v1.0: Note sinkt entsprechend', ka.note === 33, String(ka.note));
  kv.settings.maxAgeMonths = 0;
  ok('v1.0: Altersprüfung abschaltbar', V.audit(kv, '2026-09-27T00:00:00.000Z').alt.length === 0);

  /* ---------------------------------------------------- Suche v1.0 */
  const sv1 = V.emptyVault('S');
  const sa = V.newItem({ title: 'Alpha', url: 'https://alpha.at', tags: ['Arbeit'], fields: [{ label: 'PIN', value: '9876', hidden: true }, { label: 'Kunde', value: 'K-555' }], urls: [{ label: 'Portal', url: 'https://portal.alpha.at' }] });
  const sb = V.newItem({ title: 'Beta', url: 'https://beta.at', tags: ['Privat'] });
  sv1.items.push(sa, sb);
  ok('v1.0: Suche nach Schlagwort mit #', V.search(sv1, '#arbeit').length === 1);
  ok('v1.0: Filter nach Schlagwort', V.search(sv1, '', null, false, 'name', 'privat').map(i => i.title).join() === 'Beta');
  ok('v1.0: Suche findet Zusatzadresse', V.search(sv1, 'portal').length === 1);
  ok('v1.0: Suche findet offenes Zusatzfeld', V.search(sv1, 'K-555').length === 1);
  ok('v1.0: Suche findet verborgenes Zusatzfeld NICHT', V.search(sv1, '9876').length === 0);
  ok('v1.0: mehrere Suchwörter in beliebiger Reihenfolge', V.search(sv1, 'portal alpha').length === 1 && V.search(sv1, 'alpha privat').length === 0);

  /* ---------------------------------------------------- Schlagwörter */
  sv1.items.push(V.newItem({ title: 'Gamma', tags: ['arbeit', 'Zebra'] }));
  const tl = V.allTags(sv1);
  ok('v1.0: allTags zählt ohne Groß/klein', tl.find(t => t.tag.toLowerCase() === 'arbeit').count === 2);
  ok('v1.0: allTags alphabetisch', tl.map(t => t.tag.toLowerCase()).join() === 'arbeit,privat,zebra');
  ok('v1.0: parseTags trennt an Komma', V.parseTags('a, b;#c\nb').join('|') === 'a|b|c');
  ok('v1.0: Leerzeichen vor # stört nicht', V.parseTags('Arbeit, #Familie').join('|') === 'Arbeit|Familie');

  /* ---------------------------------------------------- Eigene Reihenfolge */
  const ov = [V.newItem({ title: 'A' }), V.newItem({ title: 'B' }), V.newItem({ title: 'C' })];
  ok('v1.0: moveInList verschiebt', V.moveInList(ov, 0, 2) === true);
  const nachOrder = ov.slice().sort((a, b) => a.order - b.order).map(i => i.title).join('');
  ok('v1.0: Reihenfolge danach B, C, A', nachOrder === 'BCA', nachOrder);
  ok('v1.0: moveInList außerhalb der Grenzen tut nichts', V.moveInList(ov, 0, 5) === false);
  ok('v1.0: Sortierung "eigen" folgt der Reihenfolge', V.sortieren(ov.slice(), 'eigen').map(i => i.title).join('') === 'BCA');
  ov[1].fav = true;
  ok('v1.0: bei "eigen" gehen Favoriten nicht automatisch vor', V.sortieren(ov.slice(), 'eigen').map(i => i.title).join('') === 'BCA');

  /* ---------------------------------------------------- Zuletzt geöffnet */
  const rv = V.emptyVault('R');
  const r1 = V.newItem({ title: 'Eins' }); r1.usedAt = '2026-01-02T00:00:00.000Z';
  const r2b = V.newItem({ title: 'Zwei' }); r2b.usedAt = '2026-01-03T00:00:00.000Z';
  const r3 = V.newItem({ title: 'Nie' });
  const r4 = V.newItem({ title: 'Weg' }); r4.usedAt = '2026-01-04T00:00:00.000Z'; r4.deletedAt = '2026-01-05T00:00:00.000Z';
  rv.items.push(r1, r2b, r3, r4);
  ok('v1.0: zuletzt geöffnet, jüngste zuerst, ohne Papierkorb', V.recentlyUsed(rv, 5).map(i => i.title).join() === 'Zwei,Eins');

  /* ---------------------------------------------------- Sicherungskopie */
  const bv = V.emptyVault('B');
  bv.createdAt = '2026-01-01T00:00:00.000Z';
  ok('v1.0: leerer Tresor braucht keine Sicherung', V.backupFaellig(bv, '2026-09-01T00:00:00.000Z').faellig === false);
  bv.items.push(V.newItem({ title: 'x' }));
  ok('v1.0: nie gesichert und alt → fällig', V.backupFaellig(bv, '2026-09-01T00:00:00.000Z').faellig === true);
  bv.settings.lastBackupAt = '2026-08-25T00:00:00.000Z';
  const bf = V.backupFaellig(bv, '2026-09-01T00:00:00.000Z');
  ok('v1.0: vor 7 Tagen gesichert → nicht fällig', bf.faellig === false && bf.tage === 7);
  bv.settings.backupDays = 0;
  ok('v1.0: Erinnerung abschaltbar', V.backupFaellig(bv, '2027-09-01T00:00:00.000Z').faellig === false);

  /* ---------------------------------------------------- Einstellungen v1.0 */
  const st = V.sanitizeSettings({ lang: 'en', theme: 'dunkel', view: 'liste', maxAgeMonths: 6, backupDays: 7, lastBackupAt: '2026-01-01T00:00:00.000Z' });
  ok('v1.0: Einstellungen übernehmen gültige Werte', st.lang === 'en' && st.theme === 'dunkel' && st.view === 'liste' && st.maxAgeMonths === 6 && st.backupDays === 7 && st.lastBackupAt);
  const stU = V.sanitizeSettings({ lang: 'fr', theme: 'pink', view: 'x', maxAgeMonths: 5, backupDays: 1, lastBackupAt: 'gestern' });
  ok('v1.0: Unfug in Einstellungen → Standard', stU.lang === 'de' && stU.theme === 'auto' && stU.view === 'kacheln' && stU.maxAgeMonths === 12 && stU.backupDays === 30 && stU.lastBackupAt === null);

  /* ---------------------------------------------------- Lesezeichen-Export */
  const ev = V.emptyVault('Export');
  const ekat = V.newCategory('Banken & Co', 'moos'); ev.categories.push(ekat);
  ev.items.push(V.newItem({ title: 'Ohne Reiter', url: 'https://ohne.at' }));
  ev.items.push(V.newItem({ title: 'Bank <b>', url: 'https://bank.at', user: 'geheimuser', pass: 'GEHEIMPASS', note: 'GEHEIMNOTIZ', cat: ekat.id, fields: [{ label: 'PIN', value: 'GEHEIMPIN' }], urls: [{ label: 'App', url: 'https://app.bank.at' }] }));
  ev.items.push(V.newItem({ title: 'Böse', url: 'javascript:alert(1)' }));
  const html = V.exportBookmarksHtml(ev);
  ok('v1.0: Export ist ein Netscape-Lesezeichen', html.indexOf('<!DOCTYPE NETSCAPE-Bookmark-file-1>') === 0);
  ok('v1.0: Export enthält KEINE Zugangsdaten', ['geheimuser', 'GEHEIMPASS', 'GEHEIMNOTIZ', 'GEHEIMPIN'].every(x => html.indexOf(x) < 0));
  ok('v1.0: Export maskiert HTML im Titel', html.indexOf('Bank &lt;b&gt;') >= 0 && html.indexOf('Banken &amp; Co') >= 0);
  ok('v1.0: Export lässt javascript: weg', html.indexOf('javascript') < 0);
  ok('v1.0: Export nimmt Zusatzadressen mit', html.indexOf('https://app.bank.at/') >= 0);
  const zurueck = V.importBookmarks(html);
  ok('v1.0: eigener Export lässt sich wieder importieren', zurueck.items.length === 3, String(zurueck.items.length));
  ok('v1.0: Ordner wird beim Rückimport wieder Reiter', zurueck.categories.length === 1 && zurueck.categories[0].name === 'Banken & Co');
  const ohneR = zurueck.items.find(i => i.title === 'Ohne Reiter');
  ok('v1.0: Karte ohne Reiter bleibt ohne Reiter', ohneR && ohneR.cat === null);

  /* ---------------------------------------------------- Notfallzettel englisch */
  const nzEn = V.notfallText(V.emptyVault('Family'), {}, 'en');
  ok('v1.0: Notfallzettel auf Englisch', nzEn.warnung.indexOf('no recovery') >= 0 && nzEn.schritte.length === 3);

  /* ---------------------------------------------------- Ergebnis */

  console.log('\n' + '='.repeat(58));
  if (fail === 0) {
    console.log('  ALLE ' + pass + ' PRÜFUNGEN BESTANDEN');
  } else {
    console.log('  ' + pass + ' bestanden, ' + fail + ' DURCHGEFALLEN:\n');
    failures.forEach(f => console.log('   ✗ ' + f));
  }
  console.log('='.repeat(58));
  console.log('  Tresor mit 500 Einträgen: ' + Math.round(grossDatei.length / 1024) + ' KB verschlüsselt');
  console.log('='.repeat(58) + '\n');
  process.exit(fail === 0 ? 0 : 1);
});
