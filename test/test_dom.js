/* Prüft die fertige PasswortPeter.html in einer browserähnlichen Umgebung.
 *
 * Wichtig: kein Dateisystem, kein Netz. Jeder Versuch, etwas nachzuladen,
 * fliegt hier auf. Genau das soll geprüft werden.
 *
 * v1.0: für die neu gebaute Oberfläche umgeschrieben. Die Prüfgedanken aus
 * v0.4 sind alle noch da (kein Netz, kein HTML aus Fremddaten, Passwort nicht
 * im Klartext, Notfallzettel ohne Passwort, Sperren leert alles), dazu die
 * neuen Funktionen. Ergänzt wird das von test_browser.js im echten Chromium.
 *
 * Aufruf: node test/test_dom.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const DATEI = path.join(__dirname, '..', 'dist', 'PasswortPeter.html');

let pass = 0, fail = 0;
const failures = [];
const netzversuche = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('   ok    ' + name); }
  else { fail++; failures.push(name + (detail ? '  →  ' + detail : '')); console.log('   NEIN  ' + name + (detail ? '  ' + detail : '')); }
}

const vc = new VirtualConsole();
const konsolenfehler = [];
vc.on('jsdomError', e => konsolenfehler.push('jsdomError: ' + e.message));
vc.on('error', (...a) => konsolenfehler.push('error: ' + a.join(' ')));

const html = fs.readFileSync(DATEI, 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///home/familie/PasswortPeter.html',
  virtualConsole: vc,
  resources: undefined            // nichts wird nachgeladen
});

const w = dom.window;
const d = w.document;

/* Jeden Ausweg ins Netz zunageln und protokollieren. */
w.fetch = function (u) { netzversuche.push('fetch ' + u); return Promise.reject(new Error('kein Netz')); };
w.XMLHttpRequest = function () {
  return { open: (m, u) => netzversuche.push('XHR ' + u), send: () => {}, setRequestHeader: () => {}, addEventListener: () => {} };
};
w.WebSocket = function (u) { netzversuche.push('WebSocket ' + u); throw new Error('kein Netz'); };
w.navigator.sendBeacon = function (u) { netzversuche.push('beacon ' + u); return false; };

/* Was jsdom nicht mitbringt. Downloads werden samt Inhalt mitgeschnitten. */
const downloads = [];
const blobs = new Map();
let blobNr = 0;
w.URL.createObjectURL = function (b) { const u = 'blob:jsdom/' + (++blobNr); blobs.set(u, b); return u; };
w.URL.revokeObjectURL = function () {};
w.HTMLAnchorElement.prototype.click = function () {
  if (this.hasAttribute('download')) { downloads.push({ name: this.getAttribute('download'), blob: blobs.get(this.getAttribute('href')) }); }
};
let ablage = null;
w.navigator.clipboard = { writeText: t => { ablage = t; return Promise.resolve(); } };
d.execCommand = () => true;
const geoeffnet = [];
w.open = function (u) { geoeffnet.push(u); return { opener: null }; };
w.confirm = () => true;

function warten(ms) { return new Promise(r => setTimeout(r, ms)); }
async function warteAuf(pruefung, maxMs, was) {
  const bis = Date.now() + maxMs;
  while (Date.now() < bis) {
    if (pruefung()) { return true; }
    await warten(50);
  }
  throw new Error('Zeitüberschreitung beim Warten auf: ' + was);
}
function klick(n) { n.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
function tippe(n, wert) { n.value = wert; n.dispatchEvent(new w.Event('input', { bubbles: true })); }
function $(s) { return d.querySelector(s); }
function $$(s) { return Array.from(d.querySelectorAll(s)); }
function knopfMitText(re, wo) { return $$((wo || '') + ' button').find(b => re.test(b.textContent)); }
function blobText(b) {
  return new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(b); });
}
function blobBytes(b) {
  return new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(new w.Uint8Array(r.result)); r.onerror = rej; r.readAsArrayBuffer(b); });
}
function dialog() { return $('#vorhang-halter .vorhang:not(.versteckt) .blatt'); }
function zu() { const z = $('#vorhang-halter .blatt__zu'); if (z) { klick(z); } }

(async function () {
  console.log('\n  Die gebaute Datei in einer Umgebung ohne Netz und ohne Dateisystem\n');

  const t0 = Date.now();
  await warteAuf(() => w.sodium && w.sodium.crypto_pwhash, 60000, 'libsodium');
  const startMs = Date.now() - t0;

  ok('libsodium startet aus der Datei selbst', typeof w.sodium.crypto_pwhash === 'function');
  ok('Argon2id ist wirklich da', w.sodium.crypto_pwhash_ALG_ARGON2ID13 === 2);
  ok('Start ohne einen einzigen Netzversuch', netzversuche.length === 0, netzversuche.join('; '));
  console.log('         (Start in ' + startMs + ' ms)');

  /* Echtes WASM oder der langsame Notpfad? Eine Messung entscheidet. */
  const salz = w.sodium.randombytes_buf(16);
  const m0 = Date.now();
  w.sodium.crypto_pwhash(32, 'messung', salz, 3, 64 * 1024 * 1024, w.sodium.crypto_pwhash_ALG_ARGON2ID13);
  const kdfMs = Date.now() - m0;
  ok('Argon2id läuft in WASM-Geschwindigkeit, nicht im Notpfad', kdfMs < 2500, kdfMs + ' ms für 64 MiB / t=3');

  await warteAuf(() => !$('#s-start').classList.contains('versteckt'), 5000, 'Startbildschirm');
  ok('Der Startbildschirm erscheint', true);
  ok('Der Ladeschirm ist weg', $('#laedt').classList.contains('versteckt'));
  ok('Das Logo wird gezeichnet', $('#s-start .marke__logo svg') !== null);
  ok('Die Version steht auf dem Startschirm', $('#start-version').textContent === 'v1.0.0');

  const App = w.PPApp;
  const V = w.PPVault;
  const I = w.PPI18n;
  ok('Der Tresorkern ist verknüpft', !!V && typeof V.encrypt === 'function');
  ok('Die App meldet Version 1.0.0', App.version === '1.0.0');

  /* ---------------------------------------------- Sprache auf dem Startschirm */

  /* Vor dem Aufsperren entscheidet die Browsersprache; jsdom meldet en-US. */
  ok('Der Startschirm folgt der Browsersprache (en-US → Englisch)', w.navigator.language === 'en-US' && $('#b-neuer-tresor').textContent === 'Create a new vault', w.navigator.language + ' / ' + $('#b-neuer-tresor').textContent);
  const enKnopf = $$('#start-sprache button').find(b => b.textContent === 'EN');
  klick(enKnopf);
  ok('EN schaltet den Startschirm auf Englisch', $('#b-neuer-tresor').textContent === 'Create a new vault', $('#b-neuer-tresor').textContent);
  ok('Die Seite meldet lang="en"', d.documentElement.getAttribute('lang') === 'en');
  klick($$('#start-sprache button').find(b => b.textContent === 'DE'));
  ok('DE schaltet zurück', $('#b-neuer-tresor').textContent === 'Neuen Tresor anlegen');

  /* ---------------------------------------------- Tresor aufbauen */

  const daten = V.emptyVault('Familie');
  const kat = V.newCategory('Banken', 'moos');
  daten.categories.push(kat);
  daten.items.push(V.newItem({ title: 'Sparkasse', url: 'https://sparkasse.at', user: 'anna', pass: 'Geheim!2345678', cat: kat.id, fav: true, tags: ['Geld'], fields: [{ label: 'PIN', value: '4711', hidden: true }, { label: 'Kundennr', value: 'K-99' }], urls: [{ label: 'App', url: 'https://app.sparkasse.at' }] }));
  daten.items.push(V.newItem({ title: 'ORF', url: 'orf.at' }));
  daten.items.push(V.newItem({ title: 'Böse', url: 'javascript:alert(1)', pass: 'x' }));

  App.zustand.daten = daten;
  App.zustand.passwort = 'ein gutes Master-Passwort';
  App.zustand.kdf = { ops: 2, memKiB: 19 * 1024 };
  App.zustand.dateiname = 'Familie';
  App.appAufbauen();

  ok('Der Tresor geht auf', !$('#s-app').classList.contains('versteckt'));
  ok('Er beginnt in der Übersicht', $('#ansicht-titel').textContent === 'Übersicht');
  ok('Der Tresorname steht in der Seitenleiste', $('#leiste-name').textContent === 'Familie');
  ok('Der Favorit erscheint als große Kachel', $$('.karte--gross').length === 1 && $('.karte--gross').textContent.indexOf('Sparkasse') >= 0);
  ok('Die Kennzahlen zeigen drei Karten', $('.zahl .zahl__wert').textContent === '3');
  ok('Der Reiter "Banken" steht in der Navigation', $('#nav').textContent.indexOf('Banken') >= 0);
  ok('Das Schlagwort steht in der Navigation', $('#nav').textContent.indexOf('#Geld') >= 0);

  klick($('[data-nav="alle"]'));
  ok('Alle Karten zeigt drei Karten', $$('#gitter .karte').length === 3, $$('#gitter .karte').length + ' gefunden');

  /* ---------------------------------------------- Kein HTML aus Fremddaten */

  const boese = V.newItem({ title: '<img src=x onerror="window.GEHACKT=1">', url: 'https://x.at', tags: ['<b>fett</b>'], emoji: '<i>', fields: [{ label: '<svg onload=alert(1)>', value: '<script>' }] });
  daten.items.push(boese);
  App.zeichnen();
  await warten(60);
  ok('Ein Titel mit HTML wird nicht ausgeführt', w.GEHACKT === undefined);
  ok('Ein Titel mit HTML bleibt sichtbarer Text', d.body.textContent.indexOf('onerror=') >= 0);
  ok('Es entsteht kein img-Element daraus', $$('#inhalt img').length === 0);
  ok('Auch ein Schlagwort mit HTML bleibt Text', $$('#inhalt b, #nav b').length === 0);
  App.blattZeigen(boese);
  await warten(40);
  ok('Im Detailblatt entsteht aus Zusatzfeldern kein Element', $$('.vorhang script').length === 0 && $$('.vorhang svg[onload]').length === 0);
  zu();
  daten.items.pop();
  App.zeichnen();

  /* ---------------------------------------------- Suche */

  const suche = $('#suche');
  tippe(suche, 'sparkasse');
  ok('Die Suche filtert', $$('#gitter .karte').length === 1);
  tippe(suche, '#geld');
  ok('Die Suche findet Schlagwörter mit #', $$('#gitter .karte').length === 1);
  tippe(suche, '4711');
  ok('Die Suche findet verborgene Felder NICHT', $$('#gitter .karte').length === 0);
  tippe(suche, 'K-99');
  ok('Die Suche findet offene Zusatzfelder', $$('#gitter .karte').length === 1);
  tippe(suche, 'GIBTSNICHT');
  ok('Eine Suche ohne Treffer sagt das auch', $('.leer') !== null);
  tippe(suche, '');
  ok('Leere Suche zeigt wieder alles', $$('#gitter .karte').length === 3);

  /* ---------------------------------------------- Ansichten */

  klick($('[data-darstellung="liste"]'));
  ok('Umschalten auf Liste', $$('#gitter .karte--zeile').length === 3);
  klick($('[data-darstellung="kacheln"]'));
  ok('Und zurück auf Kacheln', $$('#gitter .karte--kachel').length === 3);
  klick($('[data-nav="kat:' + kat.id + '"]'));
  ok('Ein Reiter filtert', $$('#gitter .karte').length === 1 && $('#ansicht-titel').textContent === 'Banken');
  klick($$('#nav .chip').find(c => c.textContent.indexOf('#Geld') === 0));
  ok('Ein Schlagwort filtert', $$('#gitter .karte').length === 1 && $('#ansicht-titel').textContent === '#Geld');
  klick($('[data-nav="alle"]'));

  /* ---------------------------------------------- Detailblatt */

  App.blattZeigen(daten.items[0]);
  await warten(40);
  ok('Das Blatt geht auf', dialog() !== null);
  ok('Das Passwort steht nicht im Klartext im Blatt', dialog().textContent.indexOf('Geheim!2345678') < 0);
  ok('Die verborgene PIN steht nicht im Klartext im Blatt', dialog().textContent.indexOf('4711') < 0);
  ok('Das offene Zusatzfeld steht im Blatt', dialog().textContent.indexOf('K-99') >= 0);
  ok('Die weitere Adresse steht im Blatt', dialog().textContent.indexOf('https://app.sparkasse.at') >= 0);

  const augen = $$('.vorhang [data-tun="zeigen"]');
  ok('Passwort und PIN haben je ein Auge', augen.length === 2);
  klick(augen[0]);
  ok('Das Auge zeigt das Passwort', dialog().textContent.indexOf('Geheim!2345678') >= 0);

  klick($('#b-blatt-oeffnen'));
  ok('Website öffnen ruft die richtige Adresse', geoeffnet[geoeffnet.length - 1] === 'https://sparkasse.at/', geoeffnet.join(','));
  ok('Öffnen merkt sich „zuletzt benutzt“', !!daten.items[0].usedAt);

  const kopierKnoepfe = $$('.vorhang [data-tun="kopieren"]');
  const pwKopieren = kopierKnoepfe.find(b => /Passwort/.test(b.getAttribute('aria-label')));
  klick(pwKopieren);
  await warten(60);
  ok('Kopieren legt das Passwort in die Ablage', ablage === 'Geheim!2345678', String(ablage));

  zu();
  ok('Das Blatt geht wieder zu', dialog() === null);

  /* Die Karte mit javascript:-Adresse darf keinen Öffnen-Knopf haben. */
  const vorher = geoeffnet.length;
  const boeseKarte = $$('#gitter .karte').find(k => k.textContent.indexOf('Böse') >= 0);
  ok('Eine javascript:-Adresse bekommt keinen Öffnen-Knopf', boeseKarte.querySelector('[data-tun="oeffnen"]') === null);
  ok('Und es wurde nichts geöffnet', geoeffnet.length === vorher);

  /* ---------------------------------------------- Bearbeiten: neue Karte */

  App.blattBearbeiten(null);
  await warten(40);
  tippe($('#e-titel'), 'Neue Seite');
  tippe($('#e-url'), 'beispiel.at');
  tippe($('#e-tags'), 'Arbeit, #Familie');
  tippe($('#e-emoji'), '🚀🚀');
  klick(knopfMitText(/Weitere Adresse/, '.vorhang'));
  const urlZeile = $$('.vorhang .zeile--url input');
  tippe(urlZeile[0], 'Intranet'); tippe(urlZeile[1], 'https://intra.beispiel.at');
  klick(knopfMitText(/^PIN$/, '.vorhang'));
  const feldZeile = $$('.vorhang .zeile--feld input');
  tippe(feldZeile[1], '0000');
  klick($('#b-uebernehmen'));
  await warten(40);
  const neu = daten.items[daten.items.length - 1];
  ok('Eine neue Karte landet im Tresor', daten.items.length === 4 && neu.title === 'Neue Seite');
  ok('Und in der Kartei', $$('#gitter .karte').length === 4);
  ok('Ohne Benutzer und Passwort ist sie ein Lesezeichen', V.isBookmark(neu));
  ok('Schlagwörter werden übernommen', neu.tags.join('|') === 'Arbeit|Familie', neu.tags.join('|'));
  ok('Emoji wird auf eines begrenzt', neu.emoji === '🚀', neu.emoji);
  ok('Weitere Adresse wird übernommen', neu.urls.length === 1 && neu.urls[0].label === 'Intranet');
  ok('Die PIN-Vorlage ist verborgen', neu.fields.length === 1 && neu.fields[0].label === 'PIN' && neu.fields[0].hidden === true && neu.fields[0].value === '0000');
  ok('Ungespeicherte Änderungen werden angezeigt', App.zustand.schmutzig === true);
  ok('Der Speichern-Knopf zeigt das', $('#b-speichern').classList.contains('knopf--schmutzig'));

  /* ---------------------------------------------- Bearbeiten: Passwortverlauf */

  App.blattBearbeiten(daten.items[0]);
  await warten(40);
  tippe($('#e-pass'), 'Ganz-Neues-Passwort-2026');
  ok('Der Verlaufshinweis erscheint beim Ändern', !$$('.vorhang .feld__info').find(p => /Verlauf/.test(p.textContent)).classList.contains('versteckt'));
  klick($('#b-uebernehmen'));
  await warten(40);
  ok('Das neue Passwort ist gesetzt', daten.items[0].pass === 'Ganz-Neues-Passwort-2026');
  ok('Das alte Passwort liegt im Verlauf', daten.items[0].history.length === 1 && daten.items[0].history[0].pass === 'Geheim!2345678');
  App.blattZeigen(daten.items[0]);
  await warten(40);
  ok('Das Detailblatt zeigt den Verlauf', $('.vorhang details.verlauf') !== null && /Früheres Passwort/.test($('.vorhang details.verlauf summary').textContent));
  ok('Der Verlauf zeigt das alte Passwort nicht im Klartext', dialog().textContent.indexOf('Geheim!2345678') < 0);
  zu();

  /* ---------------------------------------------- Speichern (Download-Weg) */

  ok('Ohne File System Access wird der Download-Weg gewählt', App.kann.ueberschreiben === false);
  const gespeichert = await App.speichern();
  await warten(40);
  ok('Speichern meldet Erfolg', gespeichert === true);
  const letzter = downloads[downloads.length - 1];
  ok('Es wird eine .peter-Datei heruntergeladen', letzter.name === 'Familie.peter', letzter.name);
  ok('Danach gilt alles als gespeichert', App.zustand.schmutzig === false);
  const gesp = V.decrypt(await blobBytes(letzter.blob), 'ein gutes Master-Passwort').data;
  ok('Die Datei enthält die neuen v1.0-Felder', gesp.items[0].history.length === 1 && gesp.items[3].urls.length === 1 && gesp.items[3].fields[0].hidden === true);

  /* ---------------------------------------------- Speichern (Überschreiben) */

  let geschrieben = null;
  const fakeHandle = {
    name: 'Familie.peter',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({ write: async (bytes) => { geschrieben = bytes; }, close: async () => {} })
  };
  App.zustand.dateiHandle = fakeHandle;
  daten.items.push(V.newItem({ title: 'Frisch', url: 'https://neu.at' }));
  App.zustand.schmutzig = true;
  const downloadsVorher = downloads.length;
  const ok2 = await App.speichern();
  await warten(40);
  ok('Überschreiben meldet Erfolg', ok2 === true);
  ok('Beim Überschreiben kommt KEIN neuer Download', downloads.length === downloadsVorher);
  ok('Die Bytes gingen an das Datei-Handle', geschrieben instanceof w.Uint8Array && geschrieben.length > 56);
  ok('Die überschriebene Datei ist ein gültiger Tresor', V.decrypt(geschrieben, 'ein gutes Master-Passwort').data.items.some(it => it.title === 'Frisch'));
  App.zustand.dateiHandle = null;
  App.zeichnen();

  /* ---------------------------------------------- Dublettenwarnung */

  daten.items.push(V.newItem({ title: 'Erste', url: 'https://e1.at', pass: 'wiederholtespw' }));
  App.zeichnen();
  App.blattBearbeiten(null);
  await warten(40);
  tippe($('#e-pass'), 'wiederholtespw');
  ok('Dublettenwarnung erscheint bei wiederverwendetem Passwort', !$('#e-dublette').classList.contains('versteckt'));
  ok('Die Warnung nennt die andere Karte', $('#e-dublette').textContent.indexOf('Erste') >= 0);
  tippe($('#e-pass'), 'ganz-eigenes-neues-passwort');
  ok('Bei einzigartigem Passwort verschwindet die Warnung', $('#e-dublette').classList.contains('versteckt'));

  /* ---------------------------------------------- Generator über dem Editor */

  klick($('.vorhang [data-tun="generator"]'));
  await warten(40);
  ok('Der Generator öffnet sich über dem Editor', $$('#vorhang-halter .vorhang').length === 2 && $('#gen-ausgabe').textContent.length === 20);
  ok('Der Editor bleibt dabei erhalten', $('#e-pass') !== null);
  klick(knopfMitText(/Merksatz/, '#vorhang-halter .vorhang:not(.versteckt)'));
  ok('Merksatz-Modus erzeugt Wörter', /-/.test($('#gen-ausgabe').textContent));
  const vorschlag = $('#gen-ausgabe').textContent;
  klick(knopfMitText(/Dieses nehmen/));
  await warten(20);
  ok('„Dieses nehmen“ trägt das Passwort in den Editor ein', $('#e-pass').value === vorschlag);
  ok('Danach ist nur noch der Editor offen', $$('#vorhang-halter .vorhang').length === 1 && !$('#vorhang-halter .vorhang').classList.contains('versteckt'));

  /* ---------------------------------------------- Fokusfalle */

  const fokusbar = $$('.vorhang .blatt button, .vorhang .blatt input, .vorhang .blatt select, .vorhang .blatt textarea');
  ok('Der Dialog hat fokussierbare Elemente', fokusbar.length > 2);
  fokusbar[fokusbar.length - 1].focus();
  $('.vorhang').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  ok('Die Fokusfalle ist aktiv (kein Absturz beim Tab)', true);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Esc schließt den Dialog', $('.vorhang') === null);

  /* ---------------------------------------------- Einstellungen */

  App.einstellungenZeigen();
  await warten(40);
  ok('Einstellungen zeigen sieben Auswahlfelder', $$('.vorhang select').length === 7, String($$('.vorhang select').length));
  $('#s-lock').value = '15';
  $('#s-kdf').value = 'streng';
  $('#s-thema').value = 'dunkel';
  $('#s-alter').value = '6';
  klick($('#b-einst-uebernehmen'));
  await warten(40);
  ok('Autosperre-Einstellung wird übernommen', daten.settings.autoLockMin === 15);
  ok('KDF-Einstellung wird übernommen', daten.settings.kdf === 'streng');
  ok('Die geänderte KDF wirkt sich auf die Parameter aus', App.zustand.kdf.memKiB === 256 * 1024);
  ok('Das dunkle Erscheinungsbild wird gesetzt', d.documentElement.getAttribute('data-theme') === 'dunkel');
  ok('Passwortalter wird übernommen', daten.settings.maxAgeMonths === 6);
  ok('Einstellungen ändern markiert ungespeichert', App.zustand.schmutzig === true);
  App.zustand.kdf = { ops: 2, memKiB: 19 * 1024 };   // für die weiteren Tests wieder schnell

  /* ---------------------------------------------- Sprache Englisch */

  App.einstellungenZeigen();
  await warten(40);
  $('#s-lang').value = 'en';
  klick($('#b-einst-uebernehmen'));
  await warten(40);
  ok('Die Sprache wird im Tresor gespeichert', daten.settings.lang === 'en');
  ok('Die Oberfläche ist jetzt englisch', $('[data-nav="alle"]').textContent.indexOf('All cards') >= 0);
  ok('Auch der Speichern-Knopf', $('#b-speichern-text').textContent === 'Save');
  ok('Die Suche hat einen englischen Platzhalter', $('#suche').getAttribute('placeholder') === 'Search …');
  App.spracheSetzen('de');
  daten.settings.lang = 'de';

  /* ---------------------------------------------- Notfallzettel */

  let gedruckt = false;
  w.print = function () { gedruckt = true; };
  App.notfallDrucken({ datei: 'Familie.peter', programm: 'D:\\PP' });
  await warten(120);
  ok('Der Notfallzettel wird zum Drucken aufgebaut', $('#druck-halter .nz-blatt') !== null);
  ok('Der Zettel nennt den Tresornamen', $('#druck-halter').textContent.indexOf('Familie') >= 0);
  ok('Der Zettel hat ein Feld zum Eintragen des Passworts', $('#druck-halter .nz-passwortkasten') !== null);
  const zettel = $('#druck-halter').textContent;
  ok('Der Zettel enthält KEIN echtes Passwort', ['Ganz-Neues-Passwort', 'Geheim!2345678', 'ein gutes Master-Passwort', '4711', 'wiederholtespw'].every(x => zettel.indexOf(x) < 0));
  ok('Der Druckbefehl wird ausgelöst', gedruckt === true);
  ok('Die Druckklasse wird gesetzt', d.body.classList.contains('drucke-nz'));
  w.dispatchEvent(new w.Event('afterprint'));
  await warten(20);
  ok('Nach dem Druck wird die Druckansicht wieder entfernt', !d.body.classList.contains('drucke-nz') && $('#druck-halter').textContent === '');
  ok('Der Druckhinweis ist übersetzt hinterlegt', d.body.getAttribute('data-druck-hinweis') === 'PasswortPeter druckt keine Tresore.');

  /* ---------------------------------------------- Reiter-Reihenfolge */

  daten.categories = [V.newCategory('Eins', 'rost'), V.newCategory('Zwei', 'moos'), V.newCategory('Drei', 'tinte')];
  daten.categories.forEach((c, i) => { c.order = i; });
  daten.items.forEach(it => { it.cat = null; });
  App.reiterVerwalten();
  await warten(40);
  const runter = $$('.vorhang .tun').filter(b => b.getAttribute('title') === 'Nach unten');
  ok('Jeder Reiter hat einen Runter-Knopf', runter.length === 3);
  klick(runter[0]);
  await warten(40);
  const reihenfolge = daten.categories.slice().sort((a, b) => a.order - b.order).map(c => c.name);
  ok('Ein Reiter lässt sich nach unten schieben', reihenfolge.join(',') === 'Zwei,Eins,Drei', reihenfolge.join(','));
  zu();

  /* ---------------------------------------------- Eigene Reihenfolge der Karten */

  App.geheZu('alle');
  while (App.zustand.sortierung !== 'eigen') { klick($('#b-sortieren')); }
  const vorOrdnung = $$('#gitter .karte').map(k => k.getAttribute('data-id'));
  const spaeter = $$('#gitter .karte')[0].querySelector('button[aria-label^="Nach hinten"]');
  ok('In eigener Reihenfolge hat jede Karte Pfeile', !!spaeter);
  klick(spaeter);
  const nachOrdnung = $$('#gitter .karte').map(k => k.getAttribute('data-id'));
  ok('Nach hinten tauscht die ersten beiden', nachOrdnung[0] === vorOrdnung[1] && nachOrdnung[1] === vorOrdnung[0]);
  ok('Die Karte behält den Fokus', d.activeElement && d.activeElement.getAttribute('data-id') === vorOrdnung[0]);
  while (App.zustand.sortierung !== 'name') { klick($('#b-sortieren')); }

  /* ---------------------------------------------- Mehrfachauswahl */

  klick($('#b-auswahl'));
  ok('Auswählen zeigt die Auswahlleiste', !$('#auswahl-leiste').classList.contains('versteckt'));
  ok('Der Plus-Knopf weicht', $('#b-neu-eintrag').classList.contains('versteckt'));
  const zwei = $$('#gitter .karte').slice(0, 2);
  zwei.forEach(klick);
  ok('Zwei Karten sind gewählt', $('#auswahl-leiste').textContent.indexOf('2 ausgewählt') >= 0);
  const ids = zwei.map(k => k.getAttribute('data-id'));
  const reiterSel = $('#auswahl-leiste select');
  reiterSel.value = daten.categories[0].id;
  reiterSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('„In Reiter“ verschiebt beide', ids.every(id => daten.items.find(i => i.id === id).cat === daten.categories[0].id));
  klick(knopfMitText(/Favorit/, '#auswahl-leiste'));
  ok('„Favorit“ markiert beide', ids.every(id => daten.items.find(i => i.id === id).fav));
  klick(knopfMitText(/Löschen/, '#auswahl-leiste'));
  ok('„Löschen“ legt beide in den Papierkorb', ids.every(id => !!daten.items.find(i => i.id === id).deletedAt));
  klick($('.zuruf__zurueck'));
  ok('Ein Griff holt beide zurück', ids.every(id => !daten.items.find(i => i.id === id).deletedAt));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Esc beendet die Auswahl', $('#auswahl-leiste').classList.contains('versteckt') && App.zustand.auswahl === null);

  /* ---------------------------------------------- Sicherheit */

  daten.items.push(V.newItem({ title: 'Schwach1', url: 'https://a1.at', pass: '123' }));
  daten.items.push(V.newItem({ title: 'Doppelt A', url: 'https://a2.at', pass: 'wiederholt' }));
  daten.items.push(V.newItem({ title: 'Doppelt B', url: 'https://a3.at', pass: 'wiederholt' }));
  daten.items.push(V.newItem({ title: 'Ohne TLS', url: 'http://klar.at', pass: 'Ein-Starkes-Passwort-Hier-1' }));
  const uralt = V.newItem({ title: 'Uralt', url: 'https://uralt.at', pass: 'Noch-Ein-Starkes-Passwort-2' });
  uralt.passChangedAt = '2020-01-01T00:00:00.000Z';
  daten.items.push(uralt);
  App.kassensturzZeigen();
  ok('Sicherheit öffnet eine eigene Ansicht', $('#ansicht-titel').textContent === 'Sicherheit');
  ok('Sicherheit zeigt die Note', $('#sicherheit-note') !== null);
  const sicherText = $('#inhalt').textContent;
  ok('Sicherheit listet den schwachen Eintrag', sicherText.indexOf('Schwach1') >= 0);
  ok('Sicherheit listet die doppelte Gruppe', $('.sich-gruppe') !== null);
  ok('Sicherheit listet die http-Adresse', sicherText.indexOf('Ohne TLS') >= 0);
  ok('Sicherheit listet das alte Passwort', sicherText.indexOf('Uralt') >= 0);
  ok('Die Seitenleiste zeigt eine Warnmarke', $('[data-nav="sicherheit"] .nav__marke') !== null);
  klick($('.sich-reihe'));
  await warten(40);
  ok('Klick auf eine Zeile öffnet den Bearbeiten-Dialog', dialog() && /bearbeiten/.test(dialog().querySelector('.blatt__titel').textContent));
  zu();

  /* ---------------------------------------------- Sicherungskopie und Lesezeichen */

  App.geheZu('start');
  daten.settings.lastBackupAt = null;
  daten.createdAt = '2020-01-01T00:00:00.000Z';
  App.zeichnen();
  ok('Das Sicherungs-Banner erscheint, wenn nie gesichert', $('#banner-halter .banner') !== null);
  klick(knopfMitText(/Jetzt sichern/, '#banner-halter'));
  const sich = downloads[downloads.length - 1];
  ok('Die Sicherungskopie trägt Datum im Namen', /^Familie_Sicherung_\d{4}-\d{2}-\d{2}\.peter$/.test(sich.name), sich.name);
  ok('Die Sicherungskopie ist ein gültiger, verschlüsselter Tresor', V.decrypt(await blobBytes(sich.blob), 'ein gutes Master-Passwort').data.name === 'Familie');
  ok('Das Datum der Sicherung wird vermerkt', !!daten.settings.lastBackupAt);
  ok('Danach ist das Banner weg', $('#banner-halter .banner') === null);

  App.lesezeichenExportieren();
  const lz = downloads[downloads.length - 1];
  const lzText = await blobText(lz.blob);
  ok('Lesezeichen werden als HTML gespeichert', lz.name === 'Familie_Lesezeichen.html' && lzText.indexOf('NETSCAPE-Bookmark') >= 0);
  ok('Die Lesezeichen enthalten KEIN Passwort', ['Ganz-Neues-Passwort', 'Geheim!2345678', 'wiederholt', '4711', 'anna'].every(x => lzText.indexOf(x) < 0));

  /* ---------------------------------------------- Papierkorb */

  const vorLoeschen = V.liveCount(daten);
  App.loeschenFragen(daten.items.find(it => it.title === 'Schwach1'));
  await warten(40);
  ok('Löschen entfernt die Karte aus der Ansicht', V.liveCount(daten) === vorLoeschen - 1);
  ok('Aber der Eintrag ist noch da, nur im Papierkorb', V.trashList(daten).length >= 1);
  ok('Es erscheint ein Zurückholen-Zuruf', $('.zuruf__zurueck') !== null);
  klick($('.zuruf__zurueck'));
  ok('Zurückholen stellt die Karte wieder her', V.liveCount(daten) === vorLoeschen);

  App.loeschenFragen(daten.items.find(it => it.title === 'Doppelt A'));
  await warten(40);
  klick($('[data-nav="papierkorb"]'));
  ok('Die Papierkorb-Ansicht zeigt gelöschte Karten', $('.karte--muell') !== null);
  klick($('.karte--muell [data-tun="zurueck"]'));
  ok('Zurückholen aus dem Papierkorb wirkt', V.trashList(daten).length === 0);

  /* ---------------------------------------------- Import */

  App.importZeigen();
  await warten(40);
  ok('Import öffnet ein Blatt', $('.vorhang .ablage') !== null);
  const csv = 'name,url,username,password,folder\nAmazon,https://amazon.de,kunde,pw-amazon,Eingekauft\nZalando,https://zalando.at,kunde2,pw-zalando,Eingekauft\n';
  const dateiKnopf = $('#import-datei');
  Object.defineProperty(dateiKnopf, 'files', { value: [new w.File([csv], 'export.csv', { type: 'text/csv' })], configurable: true });
  dateiKnopf.dispatchEvent(new w.Event('change', { bubbles: true }));
  await warteAuf(() => $('#b-import-uebernehmen'), 3000, 'Import-Vorschau');
  const vorImport = V.liveCount(daten);
  klick($('#b-import-uebernehmen'));
  await warten(40);
  ok('Import fügt neue Karten hinzu', V.liveCount(daten) === vorImport + 2);
  ok('Import legt den Reiter an', daten.categories.some(c => c.name === 'Eingekauft'));

  /* ---------------------------------------------- Master-Passwort ändern */

  App.masterAendern();
  await warten(40);
  $('#m-alt').value = 'ein gutes Master-Passwort';
  $('#m-neu1').value = 'ein noch besseres Passwort!';
  $('#m-neu2').value = 'ein noch besseres Passwort!';
  App.zustand.kdf = { ops: 2, memKiB: 19 * 1024 };
  klick($('#b-master'));
  await warten(80);
  ok('Master-Passwort im Speicher ist geändert', App.zustand.passwort === 'ein noch besseres Passwort!');
  const nachBytes = V.encrypt(daten, App.zustand.passwort, { ops: 2, memKiB: 19 * 1024 });
  let altGeht = false;
  try { V.decrypt(nachBytes, 'ein gutes Master-Passwort'); altGeht = true; } catch (e) { /* gut */ }
  ok('Das alte Passwort öffnet den neu verschlüsselten Tresor nicht mehr', altGeht === false);
  ok('Das neue Passwort öffnet ihn', V.decrypt(nachBytes, 'ein noch besseres Passwort!').data.name === 'Familie');

  /* ---------------------------------------------- Über, Menü */

  App.menueZeigen();
  ok('Das Menü hat zehn Einträge', $$('.vorhang .menue__eintrag').length === 10, String($$('.vorhang .menue__eintrag').length));
  klick(knopfMitText(/Über PasswortPeter/, '.vorhang'));
  ok('„Über“ nennt Version und Format', dialog() && /Version 1\.0\.0/.test(dialog().textContent) && /Dateiformat 1/.test(dialog().textContent));
  zu();

  /* ---------------------------------------------- Zusperren */

  App.sperren();
  await warten(40);
  ok('Zusperren löscht die Daten aus dem Speicher', App.zustand.daten === null);
  ok('Zusperren löscht das Master-Passwort aus dem Speicher', App.zustand.passwort === null);
  ok('Zusperren löscht das Datei-Handle', App.zustand.dateiHandle === null);
  ok('Zusperren leert die Zwischenablage', ablage === '');
  ok('Zusperren leert die Anzeige', $('#inhalt').textContent === '' && $('#nav').textContent === '');
  ok('Zusperren setzt das Erscheinungsbild zurück', !d.documentElement.hasAttribute('data-theme'));
  ok('Danach ist wieder der Startbildschirm da', !$('#s-start').classList.contains('versteckt'));

  /* ---------------------------------------------- Datei einlesen */

  const erwarteteKarten = V.liveCount(daten);
  const bytes = V.encrypt(daten, 'ein gutes Master-Passwort', { ops: 2, memKiB: 19 * 1024 });
  App.dateiLesen(new w.File([bytes], 'Familie.peter', { type: 'application/octet-stream' }));
  await warteAuf(() => !$('#s-auf').classList.contains('versteckt'), 5000, 'Aufsperrbildschirm');
  ok('Eine echte Tresordatei führt zum Aufsperren', true);
  ok('Der Name des Tresors steht dort', $('#auf-mitte').textContent.indexOf('Familie') >= 0);
  ok('Die KDF-Parameter aus der Datei werden angezeigt', $('#auf-mitte').textContent.indexOf('19 MiB') >= 0);

  async function versuch(pw) {
    $('#auf-pw').value = pw;
    klick($('#b-aufsperren'));
  }
  const fehler = () => $('#auf-mitte .warnung');
  await versuch('falsch 1');
  await warteAuf(() => !fehler().classList.contains('versteckt'), 8000, 'Fehlermeldung');
  ok('Ein falsches Passwort wird abgewiesen', fehler().textContent.indexOf('Falsches Master-Passwort') >= 0, fehler().textContent);
  ok('Und das Feld wird geleert', $('#auf-pw').value === '');
  await versuch('falsch 2');
  await warteAuf(() => App.zustand.fehlversuche === 2, 8000, 'zweiter Fehlversuch');
  await warten(60);
  await versuch('falsch 3');
  await warteAuf(() => App.zustand.fehlversuche === 3, 8000, 'dritter Fehlversuch');
  await warten(60);
  ok('Ab dem dritten Fehlversuch gibt es eine Wartezeit', $('#b-aufsperren').disabled === true && /Noch \d+ s warten/.test(fehler().textContent), fehler().textContent);
  await versuch('ein gutes Master-Passwort');
  await warten(100);
  ok('Während der Wartezeit wird nicht geprüft', $('#s-app').classList.contains('versteckt'));
  App.zustand.sperreBis = 0;   // Wartezeit für den Test abkürzen

  await versuch('ein gutes Master-Passwort');
  await warteAuf(() => !$('#s-app').classList.contains('versteckt'), 15000, 'Tresor nach dem Aufsperren');
  ok('Das richtige Passwort sperrt auf', V.liveCount(App.zustand.daten) === erwarteteKarten, 'erwartet ' + erwarteteKarten);
  ok('Der Fehlversuch-Zähler ist danach zurückgesetzt', App.zustand.fehlversuche === 0);
  App.geheZu('alle');
  ok('Der ganze Weg Datei → Passwort → Tresor steht', $$('#gitter .karte').length === erwarteteKarten);

  /* ---------------------------------------------- Eine kaputte Datei */

  const kaputt = bytes.slice(); kaputt[3] = 0x00;
  App.sperren();
  await warten(40);
  App.dateiLesen(new w.File([kaputt], 'kaputt.peter'));
  await warteAuf(() => !$('#start-fehler').classList.contains('versteckt'), 4000, 'Fehler bei kaputter Datei');
  ok('Eine fremde Datei wird sauber abgelehnt', $('#start-fehler').textContent.indexOf('keine PasswortPeter-Datei') >= 0);

  /* ---------------------------------------------- Englisch vor dem Aufsperren */

  I.setLang('en');
  App.dateiLesen(new w.File([kaputt], 'kaputt.peter'));
  await warteAuf(() => /not a PasswortPeter file/.test($('#start-fehler').textContent), 4000, 'englische Fehlermeldung');
  ok('Fehler aus dem Kern werden übersetzt', true);
  App.spracheSetzen('de');

  /* ---------------------------------------------- Abschluss */

  ok('Kein einziger Netzversuch im ganzen Durchlauf', netzversuche.length === 0, netzversuche.join('; '));
  ok('Keine Fehler in der Konsole', konsolenfehler.length === 0, konsolenfehler.slice(0, 2).join(' | '));

  console.log('\n' + '  ' + '='.repeat(56));
  if (fail === 0) {
    console.log('  ALLE ' + pass + ' PRÜFUNGEN BESTANDEN');
  } else {
    console.log('  ' + pass + ' bestanden, ' + fail + ' DURCHGEFALLEN:\n');
    failures.forEach(f => console.log('   ✗ ' + f));
  }
  console.log('  ' + '='.repeat(56) + '\n');

  w.close();
  process.exit(fail === 0 ? 0 : 1);
}()).catch(e => {
  console.log('\n  ABBRUCH: ' + e.message);
  console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  if (konsolenfehler.length) { console.log('\n  Konsole:\n   ' + konsolenfehler.slice(0, 5).join('\n   ')); }
  process.exit(1);
});
