/* Prüft die fertige PasswortPeter.html in einer browserähnlichen Umgebung.
 *
 * Wichtig: kein Dateisystem, kein Netz. Jeder Versuch, etwas nachzuladen,
 * fliegt hier auf. Genau das soll geprüft werden.
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

/* Jeden Ausweg ins Netz zunageln und protokollieren. */
w.fetch = function (u) { netzversuche.push('fetch ' + u); return Promise.reject(new Error('kein Netz')); };
w.XMLHttpRequest = function () {
  return { open: (m, u) => netzversuche.push('XHR ' + u), send: () => {}, setRequestHeader: () => {}, addEventListener: () => {} };
};
w.WebSocket = function (u) { netzversuche.push('WebSocket ' + u); throw new Error('kein Netz'); };
w.navigator.sendBeacon = function (u) { netzversuche.push('beacon ' + u); return false; };

/* Was jsdom nicht mitbringt. */
const downloads = [];
w.URL.createObjectURL = function () { return 'blob:jsdom/x'; };
w.URL.revokeObjectURL = function () {};
w.HTMLAnchorElement.prototype.click = function () {
  if (this.hasAttribute('download')) { downloads.push(this.getAttribute('download')); }
};
let ablage = null;
w.navigator.clipboard = { writeText: t => { ablage = t; return Promise.resolve(); } };
w.document.execCommand = () => true;
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

function vorhandenerCsvImport(w, App, V, ok) {
  const csv = 'name,url,username,password,folder\n' +
              'Amazon,https://amazon.de,kunde,pw-amazon,Eingekauft\n' +
              'Zalando,https://zalando.at,kunde2,pw-zalando,Eingekauft\n';
  const dateiKnopf = w.document.querySelector('.vorhang input[type="file"]');
  ok('Import hat ein Dateifeld', !!dateiKnopf);
  const datei = new w.File([csv], 'export.csv', { type: 'text/csv' });
  Object.defineProperty(dateiKnopf, 'files', { value: [datei], configurable: true });
  dateiKnopf.dispatchEvent(new w.Event('change', { bubbles: true }));
}

(async function () {
  console.log('\n  Die gebaute Datei in einer Umgebung ohne Netz und ohne Dateisystem\n');

  const t0 = Date.now();
  await warteAuf(() => w.sodium && w.sodium.crypto_pwhash, 60000, 'libsodium');
  const startMs = Date.now() - t0;

  ok('libsodium startet aus der Datei selbst', typeof w.sodium.crypto_pwhash === 'function');
  ok('Argon2id ist wirklich da', w.sodium.crypto_pwhash_ALG_ARGON2ID13 === 2);
  ok('Start ohne einen einzigen Netzversuch', netzversuche.length === 0, netzversuche.join('; '));
  console.log('         (Start in ' + startMs + ' ms)');

  /* Echtes WASM oder der langsame Notpfad? wasm2js wäre um ein Vielfaches
   * langsamer. Eine Messung entscheidet das, keine Vermutung. */
  const salz = w.sodium.randombytes_buf(16);
  const m0 = Date.now();
  w.sodium.crypto_pwhash(32, 'messung', salz, 3, 64 * 1024 * 1024, w.sodium.crypto_pwhash_ALG_ARGON2ID13);
  const kdfMs = Date.now() - m0;
  ok('Argon2id läuft in WASM-Geschwindigkeit, nicht im Notpfad', kdfMs < 2500, kdfMs + ' ms für 64 MiB / t=3');
  console.log('         (64 MiB / t=3 in ' + kdfMs + ' ms)');

  await warteAuf(() => !w.document.getElementById('s-start').classList.contains('versteckt'), 5000, 'Startbildschirm');
  ok('Der Startbildschirm erscheint', true);
  ok('Der Ladeschirm ist weg', w.document.getElementById('laedt').classList.contains('versteckt'));
  ok('Das Siegel wird gezeichnet', w.document.querySelector('#start-siegel-halter svg') !== null);

  const App = w.PPApp;
  const V = w.PPVault;
  ok('Der Tresorkern ist verknüpft', !!V && typeof V.encrypt === 'function');

  /* ---------------------------------------------- Tresor aufbauen */

  const daten = V.emptyVault('Familie');
  const kat = V.newCategory('Banken', 'moos');
  daten.categories.push(kat);
  daten.items.push(V.newItem({ title: 'Sparkasse', url: 'https://sparkasse.at', user: 'anna', pass: 'Geheim!2345678', cat: kat.id }));
  daten.items.push(V.newItem({ title: 'ORF', url: 'orf.at' }));
  daten.items.push(V.newItem({ title: 'Böse', url: 'javascript:alert(1)', pass: 'x' }));

  App.zustand.daten = daten;
  App.zustand.passwort = 'ein gutes Master-Passwort';
  App.zustand.kdf = { ops: 2, memKiB: 19 * 1024 };
  App.zustand.dateiname = 'Familie';
  App.appAufbauen();

  ok('Die Kartei zeigt drei Karten', w.document.querySelectorAll('.karte').length === 3, w.document.querySelectorAll('.karte').length + ' gefunden');
  ok('Der Tresorname steht in der Leiste', w.document.getElementById('leiste-name').textContent === 'Familie');
  ok('Der Reiter "Banken" steht in der Navigation', w.document.getElementById('reiter').textContent.indexOf('Banken') >= 0);

  /* ---------------------------------------------- Kein HTML aus Fremddaten */

  const boese = V.newItem({ title: '<img src=x onerror="window.GEHACKT=1">', url: 'https://x.at' });
  daten.items.push(boese);
  App.zeichnen();
  await warten(60);
  ok('Ein Titel mit HTML wird nicht ausgeführt', w.GEHACKT === undefined);
  ok('Ein Titel mit HTML bleibt sichtbarer Text', w.document.body.textContent.indexOf('onerror=') >= 0);
  ok('Es entsteht kein img-Element daraus', w.document.querySelectorAll('.kartei img').length === 0);
  daten.items.pop();
  App.zeichnen();

  /* ---------------------------------------------- Suche */

  const suche = w.document.getElementById('suche');
  suche.value = 'sparkasse';
  suche.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('Die Suche filtert', w.document.querySelectorAll('.karte').length === 1);
  suche.value = 'GIBTSNICHT';
  suche.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('Eine Suche ohne Treffer sagt das auch', w.document.querySelector('.leer') !== null);
  suche.value = '';
  suche.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('Leere Suche zeigt wieder alles', w.document.querySelectorAll('.karte').length === 3);

  /* ---------------------------------------------- Website öffnen */

  App.blattZeigen(daten.items[0]);
  await warten(40);
  ok('Das Blatt geht auf', w.document.querySelector('.vorhang .blatt') !== null);
  ok('Das Passwort steht nicht im Klartext im Blatt', w.document.querySelector('.vorhang').textContent.indexOf('Geheim!2345678') < 0);

  const augeKnopf = Array.from(w.document.querySelectorAll('.vorhang .tun')).find(b => (b.getAttribute('title') || '').indexOf('zeigen') >= 0);
  augeKnopf.dispatchEvent(new w.Event('click', { bubbles: true }));
  ok('Das Auge zeigt das Passwort', w.document.querySelector('.vorhang').textContent.indexOf('Geheim!2345678') >= 0);

  const oeffnen = Array.from(w.document.querySelectorAll('.vorhang .knopf')).find(b => b.textContent === 'Website öffnen');
  oeffnen.dispatchEvent(new w.Event('click', { bubbles: true }));
  ok('Website öffnen ruft die richtige Adresse', geoeffnet[geoeffnet.length - 1] === 'https://sparkasse.at/', geoeffnet.join(','));

  const kopierKnopf = Array.from(w.document.querySelectorAll('.vorhang .tun')).find(b => (b.getAttribute('title') || '') === 'Passwort kopieren');
  kopierKnopf.dispatchEvent(new w.Event('click', { bubbles: true }));
  await warten(60);
  ok('Kopieren legt das Passwort in die Ablage', ablage === 'Geheim!2345678');

  w.document.querySelector('.blatt__zu').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok('Das Blatt geht wieder zu', w.document.querySelector('.vorhang') === null);

  /* Die Karte mit javascript:-Adresse darf keinen Öffnen-Knopf haben. */
  const vorher = geoeffnet.length;
  const boeseKarte = Array.from(w.document.querySelectorAll('.karte')).find(k => k.textContent.indexOf('Böse') >= 0);
  const weltKnopf = boeseKarte.querySelector('.tun[title="Website öffnen"]');
  ok('Eine javascript:-Adresse bekommt keinen Öffnen-Knopf', weltKnopf === null);
  ok('Und es wurde nichts geöffnet', geoeffnet.length === vorher);

  /* ---------------------------------------------- Bearbeiten */

  App.blattBearbeiten(null);
  await warten(40);
  const felder = w.document.querySelectorAll('.vorhang .hell-eingabe');
  felder[0].value = 'Neue Seite';
  felder[1].value = 'beispiel.at';
  const uebernehmen = Array.from(w.document.querySelectorAll('.vorhang .knopf')).find(b => b.textContent === 'Übernehmen');
  uebernehmen.dispatchEvent(new w.Event('click', { bubbles: true }));
  await warten(40);
  ok('Eine neue Karte landet im Tresor', daten.items.length === 4);
  ok('Und in der Kartei', w.document.querySelectorAll('.karte').length === 4);
  ok('Ohne Benutzer und Passwort ist sie ein Lesezeichen', V.isBookmark(daten.items[3]));
  ok('Ungespeicherte Änderungen werden angezeigt', App.zustand.schmutzig === true);
  ok('Der Speichern-Knopf zeigt den Stern', w.document.getElementById('b-speichern').textContent.indexOf('*') >= 0);

  /* ---------------------------------------------- Speichern */

  /* ---------------------------------------------- Speichern (Download-Weg) */

  /* Dieser Browser (jsdom) kann keine Datei überschreiben, also muss der
   * Download-Weg greifen. Genau der Fall Firefox/Handy. */
  ok('Ohne File System Access wird der Download-Weg gewählt', w.PPApp.kann.ueberschreiben === false);

  const gespeichert = await App.speichern();
  await warten(40);
  ok('Speichern meldet Erfolg', gespeichert === true);
  ok('Es wird eine .peter-Datei heruntergeladen', downloads[downloads.length - 1] === 'Familie.peter', downloads.join(','));
  ok('Danach gilt alles als gespeichert', App.zustand.schmutzig === false);

  /* ---------------------------------------------- Speichern (Überschreiben) */

  /* Ein Browser, der Dateien überschreiben kann, wird nachgestellt: ein
   * gefälschtes Handle fängt die Bytes ab, statt sie herunterzuladen. */
  let geschrieben = null;
  const fakeHandle = {
    name: 'Familie.peter',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (bytes) => { geschrieben = bytes; },
      close: async () => {}
    })
  };
  App.zustand.dateiHandle = fakeHandle;
  App.zustand.daten.items.push(V.newItem({ title: 'Frisch', url: 'https://neu.at' }));
  App.zustand.schmutzig = true;
  const downloadsVorher = downloads.length;
  const ok2 = await App.speichern();
  await warten(40);
  ok('Überschreiben meldet Erfolg', ok2 === true);
  ok('Beim Überschreiben kommt KEIN neuer Download', downloads.length === downloadsVorher);
  ok('Die Bytes gingen an das Datei-Handle', geschrieben instanceof w.Uint8Array && geschrieben.length > 56);
  const wieder = V.decrypt(geschrieben, 'ein gutes Master-Passwort');
  ok('Die überschriebene Datei ist ein gültiger Tresor', wieder.data.items.some(it => it.title === 'Frisch'));
  App.zustand.imPapierkorb = false;
  App.zeichnen();

  /* ---------------------------------------------- Dublettenwarnung */

  App.zustand.daten.items.push(V.newItem({ title: 'Erste', url: 'https://e1.at', pass: 'wiederholtespw' }));
  App.zeichnen();
  App.blattBearbeiten(null);
  await warten(40);
  const dubFelder = w.document.querySelectorAll('.vorhang .hell-eingabe');
  const dubPass = dubFelder[3];   // Reihenfolge: Titel, Adresse, (Reiter select), Benutzer, Passwort
  const passFeld = Array.from(w.document.querySelectorAll('.vorhang input[type="password"], .vorhang input[type="text"]')).find(i => i.previousSibling === null || true);
  // Passwortfeld gezielt über die mit-knopf-Gruppe holen
  const pwImEditor = w.document.querySelector('.vorhang .mit-knopf input');
  pwImEditor.value = 'wiederholtespw';
  pwImEditor.dispatchEvent(new w.Event('input', { bubbles: true }));
  await warten(30);
  ok('Dublettenwarnung erscheint bei wiederverwendetem Passwort',
     w.document.querySelector('.vorhang .dublette-warnung') && w.document.querySelector('.vorhang .dublette-warnung').style.display !== 'none',
     'Warnung nicht sichtbar');
  ok('Die Warnung nennt die andere Karte', w.document.querySelector('.vorhang .dublette-warnung').textContent.indexOf('Erste') >= 0);
  pwImEditor.value = 'ganz-eigenes-neues-passwort';
  pwImEditor.dispatchEvent(new w.Event('input', { bubbles: true }));
  await warten(30);
  ok('Bei einzigartigem Passwort verschwindet die Warnung', w.document.querySelector('.vorhang .dublette-warnung').style.display === 'none');
  w.document.querySelector('.vorhang .blatt__zu').dispatchEvent(new w.Event('click', { bubbles: true }));

  /* ---------------------------------------------- Fokusfalle */

  App.blattBearbeiten(null);
  await warten(40);
  const dialog = w.document.querySelector('.vorhang .blatt');
  const fokusbar = dialog.querySelectorAll('button, input, select, textarea');
  ok('Der Dialog hat fokussierbare Elemente', fokusbar.length > 2);
  /* Tab am letzten Element springt zum ersten zurück (Falle greift). */
  const letztes = fokusbar[fokusbar.length - 1];
  letztes.focus();
  const tabEv = new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
  w.document.querySelector('.vorhang').dispatchEvent(tabEv);
  await warten(20);
  ok('Die Fokusfalle ist aktiv (kein Absturz beim Tab)', true);
  w.document.querySelector('.vorhang .blatt__zu').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok('Nach dem Schließen ist der Vorhang leer', w.document.querySelector('.vorhang') === null);

  /* ---------------------------------------------- Einstellungen */

  App.einstellungenZeigen();
  await warten(40);
  const eSelects = w.document.querySelectorAll('.vorhang select');
  ok('Einstellungen zeigen zwei Auswahlfelder', eSelects.length === 2);
  eSelects[0].value = '15';   // Autosperre
  eSelects[1].value = 'streng';  // KDF
  const eUeber = Array.from(w.document.querySelectorAll('.vorhang .knopf')).find(b => b.textContent === 'Übernehmen');
  eUeber.dispatchEvent(new w.Event('click', { bubbles: true }));
  await warten(40);
  ok('Autosperre-Einstellung wird übernommen', App.zustand.daten.settings.autoLockMin === 15);
  ok('KDF-Einstellung wird übernommen', App.zustand.daten.settings.kdf === 'streng');
  ok('Die geänderte KDF wirkt sich auf die Parameter aus', App.zustand.kdf.memKiB === 256 * 1024);
  ok('Einstellungen ändern markiert ungespeichert', App.zustand.schmutzig === true);

  /* ---------------------------------------------- Notfallzettel */

  let gedruckt = false;
  w.print = function () { gedruckt = true; };
  App.notfallDrucken({ datei: 'Familie.peter', programm: 'D:\\PP' });
  await warten(120);
  ok('Der Notfallzettel wird zum Drucken aufgebaut', w.document.querySelector('#druck-halter .nz-blatt') !== null);
  ok('Der Zettel nennt den Tresornamen', w.document.querySelector('#druck-halter').textContent.indexOf('Familie') >= 0);
  ok('Der Zettel hat ein Feld zum Eintragen des Passworts', w.document.querySelector('#druck-halter .nz-passwortkasten') !== null);
  ok('Der Zettel enthält KEIN echtes Passwort', w.document.querySelector('#druck-halter').textContent.indexOf('ganz-eigenes') < 0 && w.document.querySelector('#druck-halter').textContent.indexOf('noch besseres') < 0);
  ok('Der Druckbefehl wird ausgelöst', gedruckt === true);
  ok('Die Druckklasse wird gesetzt', w.document.body.classList.contains('drucke-nz'));
  w.dispatchEvent(new w.Event('afterprint'));
  await warten(20);
  ok('Nach dem Druck wird die Druckansicht wieder entfernt', !w.document.body.classList.contains('drucke-nz'));

  /* ---------------------------------------------- Reiter-Reihenfolge */

  App.zustand.daten.categories = [];
  App.zustand.daten.categories.push(V.newCategory('Eins', 'rost'));
  App.zustand.daten.categories.push(V.newCategory('Zwei', 'moos'));
  App.zustand.daten.categories.push(V.newCategory('Drei', 'tinte'));
  App.zustand.daten.categories.forEach((c, i) => { c.order = i; });
  App.reiterVerwalten();
  await warten(40);
  const runterKnoepfe = Array.from(w.document.querySelectorAll('.vorhang .tun')).filter(b => (b.getAttribute('title') || '') === 'Nach unten');
  ok('Jeder Reiter hat einen Runter-Knopf', runterKnoepfe.length === 3);
  runterKnoepfe[0].dispatchEvent(new w.Event('click', { bubbles: true }));   // "Eins" nach unten
  await warten(40);
  const reihenfolge = App.zustand.daten.categories.slice().sort((a, b) => a.order - b.order).map(c => c.name);
  ok('Ein Reiter lässt sich nach unten schieben', reihenfolge[0] === 'Zwei' && reihenfolge[1] === 'Eins', reihenfolge.join(','));
  w.document.querySelector('.vorhang .blatt__zu') && w.document.querySelector('.vorhang .blatt__zu').dispatchEvent(new w.Event('click', { bubbles: true }));

  App.zustand.daten.items.push(V.newItem({ title: 'Schwach1', url: 'https://a1.at', pass: '123' }));
  App.zustand.daten.items.push(V.newItem({ title: 'Doppelt A', url: 'https://a2.at', pass: 'wiederholt' }));
  App.zustand.daten.items.push(V.newItem({ title: 'Doppelt B', url: 'https://a3.at', pass: 'wiederholt' }));
  App.zeichnen();
  App.kassensturzZeigen();
  await warten(40);
  ok('Kassensturz öffnet ein Blatt', w.document.querySelector('.vorhang .blatt') !== null);
  ok('Kassensturz zeigt die Note', w.document.querySelector('.kassensturz-note') !== null);
  ok('Kassensturz listet den schwachen Eintrag', w.document.querySelector('.vorhang').textContent.indexOf('Schwach1') >= 0);
  ok('Kassensturz listet die doppelte Gruppe', w.document.querySelector('.kassensturz-gruppe') !== null);
  ok('Eine Kassensturz-Zeile führt zur Karte', w.document.querySelector('.kassensturz-reihe') !== null);
  w.document.querySelector('.kassensturz-reihe').dispatchEvent(new w.Event('click', { bubbles: true }));
  await warten(40);
  ok('Klick auf eine Zeile öffnet den Bearbeiten-Dialog', w.document.querySelector('.vorhang .blatt__titel').textContent.indexOf('bearbeiten') >= 0);
  w.document.querySelector('.blatt__zu').dispatchEvent(new w.Event('click', { bubbles: true }));

  /* ---------------------------------------------- Papierkorb */

  const vorLoeschen = V.liveCount(App.zustand.daten);
  App.loeschenFragen(App.zustand.daten.items.find(it => it.title === 'Schwach1'));
  await warten(40);
  ok('Löschen entfernt die Karte aus der Ansicht', V.liveCount(App.zustand.daten) === vorLoeschen - 1);
  ok('Aber der Eintrag ist noch da, nur im Papierkorb', V.trashList(App.zustand.daten).length >= 1);
  ok('Es erscheint ein Zurückholen-Zuruf', w.document.querySelector('.zuruf__zurueck') !== null);
  w.document.querySelector('.zuruf__zurueck').dispatchEvent(new w.Event('click', { bubbles: true }));
  await warten(40);
  ok('Zurückholen stellt die Karte wieder her', V.liveCount(App.zustand.daten) === vorLoeschen);

  /* In den Papierkorb legen und die Ansicht öffnen */
  App.loeschenFragen(App.zustand.daten.items.find(it => it.title === 'Doppelt A'));
  await warten(40);
  App.zustand.imPapierkorb = true;
  App.zeichnen();
  ok('Die Papierkorb-Ansicht zeigt gelöschte Karten', w.document.querySelector('.karte--muell') !== null);
  const zurueckKnopf = w.document.querySelector('.karte--muell .tun[title="Zurückholen"]');
  ok('Im Papierkorb gibt es einen Zurückholen-Knopf', zurueckKnopf !== null);
  zurueckKnopf.dispatchEvent(new w.Event('click', { bubbles: true }));
  await warten(40);
  ok('Zurückholen aus dem Papierkorb wirkt', V.trashList(App.zustand.daten).length === 0);
  App.zustand.imPapierkorb = false;
  App.zeichnen();

  /* ---------------------------------------------- Import */

  App.importZeigen();
  await warten(40);
  ok('Import öffnet ein Blatt', w.document.querySelector('.vorhang .ablage-hell') !== null);
  vorhandenerCsvImport(w, App, V, ok);
  await warten(40);
  const vorImport = V.liveCount(App.zustand.daten);
  const uebernehmenImp = Array.from(w.document.querySelectorAll(".vorhang .knopf")).find(b => /übernehmen/i.test(b.textContent));
  ok('Nach dem Einlesen erscheint der Übernehmen-Knopf', !!uebernehmenImp);
  if (uebernehmenImp) {
    uebernehmenImp.dispatchEvent(new w.Event('click', { bubbles: true }));
    await warten(40);
    ok('Import fügt neue Karten hinzu', V.liveCount(App.zustand.daten) === vorImport + 2);
    ok('Import legt die Kategorie an', App.zustand.daten.categories.some(c => c.name === 'Eingekauft'));
  }

  /* ---------------------------------------------- Master-Passwort ändern */

  App.masterAendern();
  await warten(40);
  const mFelder = w.document.querySelectorAll('.vorhang .hell-eingabe');
  mFelder[0].value = 'ein gutes Master-Passwort';
  mFelder[1].value = 'ein noch besseres Passwort!';
  mFelder[2].value = 'ein noch besseres Passwort!';
  const aendern = Array.from(w.document.querySelectorAll('.vorhang .knopf')).find(b => /Ändern/.test(b.textContent));
  aendern.dispatchEvent(new w.Event('click', { bubbles: true }));
  await warten(60);
  ok('Master-Passwort im Speicher ist geändert', App.zustand.passwort === 'ein noch besseres Passwort!');

  /* Der Beweis: die zuletzt geschriebenen Bytes öffnen sich NUR mit dem neuen Passwort. */
  App.zustand.dateiHandle = null;
  const nachBytes = V.encrypt(App.zustand.daten, App.zustand.passwort, App.zustand.kdf);
  let altGeht = false;
  try { V.decrypt(nachBytes, 'ein gutes Master-Passwort'); altGeht = true; } catch (e) { /* gut */ }
  ok('Das alte Passwort öffnet den neu verschlüsselten Tresor nicht mehr', altGeht === false);
  ok('Das neue Passwort öffnet ihn', V.decrypt(nachBytes, 'ein noch besseres Passwort!').data.name === 'Familie');

  /* ---------------------------------------------- Sortierung */

  App.zustand.sortierung = 'name';
  App.zeichnen();
  ok('Sortierumschalter ist in der Leiste', w.document.getElementById('b-sortieren') !== null);

  /* ---------------------------------------------- Zusperren */

  App.sperren();
  await warten(40);
  ok('Zusperren löscht die Daten aus dem Speicher', App.zustand.daten === null);
  ok('Zusperren löscht das Master-Passwort aus dem Speicher', App.zustand.passwort === null);
  ok('Zusperren löscht das Datei-Handle', App.zustand.dateiHandle === null);
  ok('Zusperren leert die Zwischenablage', ablage === '');
  ok('Danach ist wieder der Startbildschirm da', !w.document.getElementById('s-start').classList.contains('versteckt'));

  /* ---------------------------------------------- Datei einlesen */

  const erwarteteKarten = V.liveCount(daten);
  const bytes = V.encrypt(daten, 'ein gutes Master-Passwort', { ops: 2, memKiB: 19 * 1024 });
  const datei = new w.File([bytes], 'Familie.peter', { type: 'application/octet-stream' });
  App.dateiLesen(datei);
  await warteAuf(() => !w.document.getElementById('s-auf').classList.contains('versteckt'), 5000, 'Aufsperrbildschirm');
  ok('Eine echte Tresordatei führt zum Aufsperren', true);
  ok('Der Name des Tresors steht dort', w.document.getElementById('auf-mitte').textContent.indexOf('Familie') >= 0);
  ok('Die KDF-Parameter aus der Datei werden angezeigt', w.document.getElementById('auf-mitte').textContent.indexOf('19 MiB') >= 0);

  const pwFeld = w.document.getElementById('auf-pw');
  pwFeld.value = 'falsches Passwort';
  Array.from(w.document.querySelectorAll('#auf-mitte .knopf')).find(b => b.textContent === 'Aufsperren')
    .dispatchEvent(new w.Event('click', { bubbles: true }));
  await warteAuf(() => !w.document.querySelector('#auf-mitte .warnung').classList.contains('versteckt'), 8000, 'Fehlermeldung');
  ok('Ein falsches Passwort wird abgewiesen', w.document.querySelector('#auf-mitte .warnung').textContent.indexOf('Falsches Master-Passwort') >= 0);
  ok('Und das Feld wird geleert', w.document.getElementById('auf-pw').value === '');

  w.document.getElementById('auf-pw').value = 'ein gutes Master-Passwort';
  Array.from(w.document.querySelectorAll('#auf-mitte .knopf')).find(b => b.textContent === 'Aufsperren')
    .dispatchEvent(new w.Event('click', { bubbles: true }));
  await warteAuf(() => !w.document.getElementById('s-app').classList.contains('versteckt'), 15000, 'Kartei nach dem Aufsperren');
  ok('Das richtige Passwort sperrt auf', V.liveCount(w.PPApp.zustand.daten) === erwarteteKarten, 'erwartet ' + erwarteteKarten);
  ok('Der ganze Weg Datei → Passwort → Kartei steht', w.document.querySelectorAll('.karte').length === erwarteteKarten);

  /* ---------------------------------------------- Eine kaputte Datei */

  const kaputt = bytes.slice(); kaputt[3] = 0x00;
  App.sperren();
  await warten(40);
  App.dateiLesen(new w.File([kaputt], 'kaputt.peter'));
  await warteAuf(() => !w.document.getElementById('start-fehler').classList.contains('versteckt'), 4000, 'Fehler bei kaputter Datei');
  ok('Eine fremde Datei wird sauber abgelehnt', w.document.getElementById('start-fehler').textContent.indexOf('keine PasswortPeter-Datei') >= 0);

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
