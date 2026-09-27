/* PasswortPeter – Prüfungen im echten Browser (v1.0)
 *
 * Bis v0.4 lief die Datei nur in jsdom, einer nachgebauten Browserumgebung.
 * Diese Reihe startet ein echtes Chromium (Playwright), öffnet die gebaute
 * Datei unter file:// und prüft, was jsdom nicht kann: echte CSP, echtes
 * WebAssembly, echte Downloads, Layout am Handy, dunkles Erscheinungsbild,
 * Ziehen mit der Maus und das Druckbild des Notfallzettels.
 *
 * Voraussetzung: npm install (bringt playwright mit) und ein Chromium. Wo
 * keins liegt: npx playwright install chromium
 *
 * Aufruf: node test/test_browser.js           Bildschirmfotos landen in test/ausgabe/
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.log('\n  playwright fehlt. Erst "npm install" ausführen.\n');
  process.exit(1);
}

const DATEI = path.join(__dirname, '..', 'dist', 'PasswortPeter.html');
const URL_DATEI = 'file://' + DATEI;
const AUSGABE = path.join(__dirname, 'ausgabe');
fs.mkdirSync(AUSGABE, { recursive: true });

const MASTER = 'Korrekt-Pferd-Batterie-Heftklammer-42';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('   ok    ' + name); }
  else { fail++; failures.push(name + (detail ? '  →  ' + detail : '')); console.log('   NEIN  ' + name + (detail ? '  ' + detail : '')); }
}

/* Jede Seite protokolliert Fehler und jeden Netzversuch. */
function beobachten(seite, log) {
  seite.on('pageerror', e => log.fehler.push('pageerror: ' + e.message));
  seite.on('console', m => { if (m.type() === 'error') { log.fehler.push('console: ' + m.text()); } });
  seite.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) { log.netz.push(r.url()); } });
}

/* Wie Firefox oder ein Handy: ohne File System Access, also Download-Weg. */
const OHNE_FSA = () => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; };

async function ueberlauf(seite) {
  return seite.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
function box(seite, sel) { return seite.locator(sel).first().boundingBox(); }
function ueberlappt(a, b) {
  return !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

(async function () {
  console.log('\n  PasswortPeter im echten Chromium\n');
  const browser = await chromium.launch();
  const log = { fehler: [], netz: [] };

  /* ================================================ Desktop, Download-Weg */

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true, locale: 'de-DE' });
  await ctx.addInitScript(OHNE_FSA);
  const s = await ctx.newPage();
  beobachten(s, log);

  await s.goto(URL_DATEI);
  await s.waitForSelector('#s-start:not(.versteckt)', { timeout: 30000 });
  ok('Die Datei startet im echten Browser', true);
  ok('Die Sicherheitsrichtlinie ist aktiv (connect-src none)', await s.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return !!m && m.content.indexOf("connect-src 'none'") >= 0;
  }));
  ok('Ein Netzversuch aus der Seite wird vom Browser blockiert', await s.evaluate(async () => {
    try { await window.fetch('https://example.com/'); return false; } catch (e) { return true; }
  }));
  log.netz.length = 0;   // der absichtliche Versuch eben zählt nicht,
  log.fehler.length = 0; // ebenso die CSP-Meldung, die er in der Konsole auslöst
  ok('Der Startschirm ist deutsch (Browser de-DE)', (await s.textContent('#b-neuer-tresor')) === 'Neuen Tresor anlegen');
  await s.screenshot({ path: path.join(AUSGABE, '01-start.png') });

  /* ---- Neuen Tresor über die Oberfläche anlegen, mit echtem Argon2id */
  await s.click('#b-neuer-tresor');
  await s.fill('#neu-name', 'Familie');
  await s.fill('#neu-pw1', 'zu kurz');
  await s.fill('#neu-pw2', 'zu kurz');
  await s.click('#b-anlegen');
  ok('Ein zu kurzes Master-Passwort wird abgelehnt', /mindestens 12 Zeichen/.test(await s.textContent('#neu-mitte .warnung')));
  await s.fill('#neu-pw1', MASTER);
  await s.fill('#neu-pw2', MASTER);
  const [dl1] = await Promise.all([s.waitForEvent('download', { timeout: 30000 }), s.click('#b-anlegen')]);
  ok('Anlegen speichert sofort eine .peter-Datei', dl1.suggestedFilename() === 'Familie.peter', dl1.suggestedFilename());
  await s.waitForSelector('#s-app:not(.versteckt)');
  ok('Danach ist der Tresor offen', (await s.textContent('#ansicht-titel')) === 'Übersicht');

  /* ---- Karten über die Oberfläche anlegen */
  async function karteAnlegen(o) {
    await s.click('#b-neu-eintrag');
    await s.fill('#e-titel', o.titel);
    if (o.url) { await s.fill('#e-url', o.url); }
    if (o.user) { await s.fill('#e-user', o.user); }
    if (o.pass) { await s.fill('#e-pass', o.pass); }
    if (o.tags) { await s.fill('#e-tags', o.tags); }
    if (o.emoji) { await s.fill('#e-emoji', o.emoji); }
    if (o.fav) { await s.click('label[for="e-fav"]'); }
    await s.click('#b-uebernehmen');
    await s.waitForSelector('.vorhang', { state: 'detached' });
  }
  await karteAnlegen({ titel: 'Sparkasse', url: 'sparkasse.de', user: 'basti', pass: 'Qx7!mZp2@kLr9#Tn', tags: 'Geld', emoji: '🏦', fav: true });
  await karteAnlegen({ titel: 'Tagesschau', url: 'https://tagesschau.de', emoji: '📰', fav: true });
  await karteAnlegen({ titel: 'Wikipedia', url: 'de.wikipedia.org' });
  await karteAnlegen({ titel: 'Schule', url: 'http://schule.example', user: 'lena', pass: 'Qx7!mZp2@kLr9#Tn' });
  ok('Vier Karten angelegt', (await s.evaluate(() => window.PPVault.liveCount(window.PPApp.zustand.daten))) === 4);
  ok('Die Übersicht zeigt zwei Favoriten als große Kacheln', (await s.locator('.karte--gross').count()) === 2);
  ok('Die Sicherheit meldet Doppelung und http', (await s.textContent('[data-nav="sicherheit"] .nav__marke')) === '2');
  await s.screenshot({ path: path.join(AUSGABE, '02-uebersicht.png') });

  /* ---- Detail: Passwort bleibt verdeckt, Auge zeigt es */
  await s.click('.karte--gross >> text=Sparkasse');
  ok('Im Detailblatt steht das Passwort nicht im Klartext', (await s.textContent('.vorhang')).indexOf('Qx7!mZp2') < 0);
  ok('Die Doppelung wird im Detail genannt', /Mehrfach benutzt/.test(await s.textContent('.vorhang .pillen')));
  await s.click('.vorhang [data-tun="zeigen"]');
  ok('Das Auge zeigt es', (await s.textContent('.vorhang')).indexOf('Qx7!mZp2@kLr9#Tn') >= 0);
  await s.screenshot({ path: path.join(AUSGABE, '03-detail.png') });
  await s.keyboard.press('Escape');
  ok('Esc schließt das Blatt', (await s.locator('.vorhang').count()) === 0);

  /* ---- Tastatur */
  await s.keyboard.press('/');
  ok('„/“ springt in die Suche', await s.evaluate(() => document.activeElement.id === 'suche'));
  await s.keyboard.type('wiki');
  ok('Die Suche filtert live', (await s.locator('#gitter .karte').count()) === 1);
  await s.keyboard.press('Escape');
  ok('Esc leert die Suche', (await s.inputValue('#suche')) === '');

  /* ---- Ziehen mit der Maus in eigener Reihenfolge */
  await s.click('[data-nav="alle"]');
  while ((await s.evaluate(() => window.PPApp.zustand.sortierung)) !== 'eigen') { await s.click('#b-sortieren'); }
  const vorher = await s.$$eval('#gitter .karte', ks => ks.map(k => k.querySelector('.karte__titel').textContent));
  await s.dragAndDrop('#gitter .karte >> nth=0', '#gitter .karte >> nth=2');
  const nachher = await s.$$eval('#gitter .karte', ks => ks.map(k => k.querySelector('.karte__titel').textContent));
  ok('Eine Karte lässt sich mit der Maus verschieben', nachher[2] === vorher[0] && nachher[0] === vorher[1], vorher.join(',') + ' → ' + nachher.join(','));
  await s.screenshot({ path: path.join(AUSGABE, '04-eigene-reihenfolge.png') });

  /* ---- Speichern mit Strg+S, Datei neu laden und aufsperren */
  const [dl2] = await Promise.all([s.waitForEvent('download'), s.keyboard.press('Control+s')]);
  const gespeichert = path.join(os.tmpdir(), 'pp-test-' + process.pid + '.peter');
  await dl2.saveAs(gespeichert);
  ok('Strg+S lädt den Tresor herunter', fs.statSync(gespeichert).size > 56);

  await s.reload();
  await s.waitForSelector('#s-start:not(.versteckt)');
  await s.setInputFiles('#b-datei', gespeichert);
  await s.waitForSelector('#s-auf:not(.versteckt)');
  /* Vor dem Aufsperren ist nur der Dateiname bekannt, der Tresorname ist ja verschlüsselt. */
  ok('Die gespeicherte Datei führt zum Aufsperren', (await s.textContent('#auf-mitte .tafel__titel')) === path.basename(gespeichert, '.peter'));
  await s.fill('#auf-pw', 'falsches Passwort');
  await s.click('#b-aufsperren');
  await s.waitForSelector('#auf-mitte .warnung:not(.versteckt)', { timeout: 30000 });
  ok('Ein falsches Passwort wird abgewiesen', /Falsches Master-Passwort/.test(await s.textContent('#auf-mitte .warnung')));
  await s.fill('#auf-pw', MASTER);
  await s.click('#b-aufsperren');
  await s.waitForSelector('#s-app:not(.versteckt)', { timeout: 30000 });
  const zurueck = await s.evaluate(() => {
    const d = window.PPApp.zustand.daten;
    const sp = d.items.find(i => i.title === 'Sparkasse');
    return { n: window.PPVault.liveCount(d), emoji: sp.emoji, tags: sp.tags.join(), fav: sp.fav, url: sp.url };
  });
  ok('Rundlauf im echten Browser: alle Karten wieder da', zurueck.n === 4);
  ok('Rundlauf: Emoji, Schlagwort und Favorit überleben', zurueck.emoji === '🏦' && zurueck.tags === 'Geld' && zurueck.fav === true, JSON.stringify(zurueck));
  ok('Die eigene Reihenfolge überlebt das Speichern', (await s.evaluate(() => window.PPVault.sortieren(window.PPApp.zustand.daten.items.slice(), 'eigen').map(i => i.title)))[2] === vorher[0]);
  fs.unlinkSync(gespeichert);

  /* ---- Druckbild: normal nichts, Notfallzettel nur der Zettel */
  await s.emulateMedia({ media: 'print' });
  const druckNormal = await s.evaluate(() => ({
    hinweis: getComputedStyle(document.body, '::after').content,
    appSichtbar: getComputedStyle(document.querySelector('#s-app .leiste')).visibility
  }));
  ok('Normales Drucken zeigt nur den Hinweis', druckNormal.hinweis.indexOf('druckt keine Tresore') >= 0, druckNormal.hinweis);
  ok('Normales Drucken versteckt den Tresor', druckNormal.appSichtbar === 'hidden');
  await s.emulateMedia({ media: 'screen' });
  await s.evaluate(() => { window.print = () => {}; window.PPApp.notfallDrucken({ datei: 'Familie.peter', programm: 'USB-Stick' }); });
  await s.waitForTimeout(150);
  await s.emulateMedia({ media: 'print' });
  const druckNz = await s.evaluate(() => ({
    zettel: getComputedStyle(document.getElementById('druck-halter')).display,
    app: getComputedStyle(document.getElementById('s-app')).display,
    zuruf: getComputedStyle(document.getElementById('zuruf-halter')).display,
    text: document.getElementById('druck-halter').innerText
  }));
  ok('Beim Notfallzettel ist der Zettel sichtbar', druckNz.zettel === 'block');
  ok('Beim Notfallzettel ist der Tresor NICHT sichtbar', druckNz.app === 'none' && druckNz.zuruf === 'none');
  ok('Der gedruckte Zettel enthält kein Passwort', druckNz.text.indexOf('Qx7!mZp2') < 0 && druckNz.text.indexOf(MASTER) < 0);
  await s.screenshot({ path: path.join(AUSGABE, '05-notfallzettel-druckbild.png'), fullPage: true });
  /* page.pdf löst wie ein echter Druck beforeprint/afterprint aus; nach
   * afterprint räumt die App den Zettel weg. Das zweite PDF ist deshalb das
   * normale Druckbild (nur der Hinweis) und dient als Vergleich. */
  const pdf = await s.pdf({ format: 'A4' });
  fs.writeFileSync(path.join(AUSGABE, 'notfallzettel.pdf'), pdf);
  ok('Nach dem Druck räumt die App den Zettel wieder weg', await s.evaluate(() => !document.body.classList.contains('drucke-nz') && document.getElementById('druck-halter').childElementCount === 0));
  const pdfLeer = await s.pdf({ format: 'A4' });
  ok('Der Zettel landet im PDF (deutlich mehr Inhalt als der bloße Hinweis)', pdf.length > pdfLeer.length * 2, pdf.length + ' zu ' + pdfLeer.length + ' Bytes');
  await s.emulateMedia({ media: 'screen' });

  /* ---- Dunkel: System und Einstellung */
  await s.emulateMedia({ colorScheme: 'dark' });
  const hintergrund = () => s.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('Dunkles System → dunkler Hintergrund', (await hintergrund()) === 'rgb(12, 15, 19)', await hintergrund());
  await s.evaluate(() => document.documentElement.setAttribute('data-theme', 'hell'));
  ok('Einstellung „Hell“ schlägt das dunkle System', (await hintergrund()) === 'rgb(244, 246, 248)', await hintergrund());
  await s.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await s.click('[data-nav="start"]');
  await s.screenshot({ path: path.join(AUSGABE, '06-dunkel.png') });
  await s.emulateMedia({ colorScheme: 'light' });

  /* ---- Englisch */
  await s.evaluate(() => window.PPApp.spracheSetzen('en'));
  ok('Englische Oberfläche', /All cards/.test(await s.textContent('[data-nav="alle"]')));
  await s.screenshot({ path: path.join(AUSGABE, '07-englisch.png') });
  await s.evaluate(() => window.PPApp.spracheSetzen('de'));

  ok('Desktop: keine Seitenfehler', log.fehler.length === 0, log.fehler.slice(0, 3).join(' | '));
  ok('Desktop: kein einziger Netzversuch', log.netz.length === 0, log.netz.slice(0, 3).join(' | '));
  await ctx.close();

  /* ================================================ Handy */

  const log2 = { fehler: [], netz: [] };
  const handy = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
  await handy.addInitScript(OHNE_FSA);
  const h = await handy.newPage();
  beobachten(h, log2);
  await h.goto(URL_DATEI);
  await h.waitForSelector('#s-start:not(.versteckt)');
  ok('Handy: Startschirm ohne seitliches Scrollen', (await ueberlauf(h)) <= 0);
  await h.screenshot({ path: path.join(AUSGABE, '10-handy-start.png') });

  await h.evaluate(() => {
    const V = window.PPVault, A = window.PPApp;
    const d = V.emptyVault('Familie mit einem sehr langen Namen');
    const k = V.newCategory('Banken', 'tinte'); d.categories.push(k);
    for (let i = 0; i < 14; i++) {
      d.items.push(V.newItem({ title: 'Eine Website mit langem Titel Nummer ' + i, url: 'https://sehr-lange-adresse-nummer-' + i + '.example.org/pfad', user: 'benutzer' + i + '@beispiel-mail.de', pass: 'Pw-' + i + '-Stark-Genug!', cat: i % 2 ? k.id : null, fav: i < 5, tags: ['Familie', 'Wichtig'] }));
    }
    A.zustand.daten = d; A.zustand.passwort = 'x'.repeat(16); A.zustand.kdf = { ops: 2, memKiB: 19 * 1024 };
    A.appAufbauen();
  });
  ok('Handy: Übersicht ohne seitliches Scrollen', (await ueberlauf(h)) <= 0, String(await ueberlauf(h)));
  const lb = await box(h, '.leiste');
  ok('Handy: die Kopfleiste bleibt einzeilig', lb && lb.height < 70, lb && String(lb.height));
  ok('Handy: die Seitenleiste ist eingeklappt', (await box(h, '#seite')).x < 0);
  await h.screenshot({ path: path.join(AUSGABE, '11-handy-uebersicht.png') });

  await h.click('#b-nav');
  await h.waitForTimeout(300);
  ok('Handy: ☰ klappt die Navigation aus', (await box(h, '#seite')).x >= 0);
  await h.screenshot({ path: path.join(AUSGABE, '12-handy-navigation.png') });
  await h.click('[data-nav="alle"]');
  await h.waitForTimeout(300);
  ok('Handy: nach der Wahl klappt sie wieder ein', (await box(h, '#seite')).x < 0);
  ok('Handy: Kartenliste ohne seitliches Scrollen', (await ueberlauf(h)) <= 0);
  await h.click('[data-darstellung="liste"]');
  ok('Handy: Listenansicht ohne seitliches Scrollen', (await ueberlauf(h)) <= 0);
  await h.screenshot({ path: path.join(AUSGABE, '13-handy-liste.png') });

  /* Zuruf und Plus-Knopf dürfen sich nicht überdecken (Fehler aus v0.4). */
  await h.evaluate(() => window.PPApp.loeschenFragen(window.PPApp.zustand.daten.items[0]));
  await h.waitForSelector('.zuruf');
  ok('Handy: der Zuruf verdeckt den Plus-Knopf nicht', !ueberlappt(await box(h, '.zuruf'), await box(h, '#b-neu-eintrag')));
  await h.screenshot({ path: path.join(AUSGABE, '14-handy-zuruf.png') });

  await h.click('#gitter .karte >> nth=0');
  await h.waitForSelector('.vorhang .blatt');
  await h.waitForTimeout(400);   // das Blatt gleitet von unten herein
  const bb = await box(h, '.vorhang .blatt');
  ok('Handy: das Detailblatt kommt von unten und nutzt die Breite', bb.width >= 388 && Math.abs(bb.y + bb.height - 844) < 2, JSON.stringify(bb));
  ok('Handy: Detailblatt ohne seitliches Scrollen', (await ueberlauf(h)) <= 0);
  ok('Handy: bei offenem Blatt verdeckt der Zuruf die Knöpfe nicht', !ueberlappt(await box(h, '.zuruf'), await box(h, '.vorhang .blatt__fuss')));
  await h.screenshot({ path: path.join(AUSGABE, '15-handy-detail.png') });
  await h.click('.vorhang .blatt__fuss >> text=Bearbeiten');
  await h.waitForSelector('#e-titel');
  await h.waitForTimeout(400);
  ok('Handy: Editor ohne seitliches Scrollen', (await ueberlauf(h)) <= 0);
  const fuss = await box(h, '.vorhang .blatt__fuss');
  ok('Handy: die Knöpfe des Editors sind sichtbar', fuss && fuss.y + fuss.height <= 844 + 1);
  await h.screenshot({ path: path.join(AUSGABE, '16-handy-editor.png') });
  await h.click('.vorhang .blatt__fuss >> text=Abbrechen');

  await h.click('#b-auswahl');
  await h.click('#gitter .karte >> nth=0');
  await h.click('#gitter .karte >> nth=1');
  ok('Handy: Auswahlleiste ohne seitliches Scrollen', (await ueberlauf(h)) <= 0);
  const al = await box(h, '#auswahl-leiste');
  ok('Handy: die Auswahlleiste sitzt unten und ist ganz sichtbar', al && al.y + al.height <= 845 && al.x >= 0 && al.x + al.width <= 391, JSON.stringify(al));
  await h.screenshot({ path: path.join(AUSGABE, '17-handy-auswahl.png') });

  ok('Handy: keine Seitenfehler', log2.fehler.length === 0, log2.fehler.slice(0, 3).join(' | '));
  ok('Handy: kein einziger Netzversuch', log2.netz.length === 0, log2.netz.slice(0, 3).join(' | '));
  await handy.close();

  /* ================================================ Chrome mit File System Access
   *
   * Ein echtes Chrome kann die Datei an Ort und Stelle überschreiben. Der
   * Dateidialog selbst lässt sich nicht fernsteuern, also liefert ein
   * nachgestelltes showSaveFilePicker das Handle; der Rest ist echt. */
  const ctx3 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx3.addInitScript(() => {
    window.__geschrieben = [];
    window.showSaveFilePicker = async () => ({
      name: 'Familie.peter',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable: async () => ({ write: async (b) => { window.__geschrieben.push(b.length); }, close: async () => {} })
    });
  });
  const c = await ctx3.newPage();
  await c.goto(URL_DATEI);
  await c.waitForSelector('#s-start:not(.versteckt)');
  await c.evaluate(() => {
    const V = window.PPVault, A = window.PPApp;
    A.zustand.daten = V.emptyVault('Familie'); A.zustand.passwort = 'x'.repeat(16); A.zustand.kdf = { ops: 2, memKiB: 19 * 1024 };
    A.appAufbauen();
  });
  const ergebnis = await c.evaluate(async () => { const a = await window.PPApp.speichern(); const b = await window.PPApp.speichern(); return { a, b, n: window.__geschrieben.length }; });
  ok('Chrome: zweimal speichern schreibt zweimal in dieselbe Datei', ergebnis.a && ergebnis.b && ergebnis.n === 2, JSON.stringify(ergebnis));
  ok('Chrome: der Speichern-Knopf nennt die Datei', /Familie\.peter/.test(await c.getAttribute('#b-speichern', 'title')));
  await ctx3.close();

  await browser.close();

  console.log('\n' + '  ' + '='.repeat(56));
  if (fail === 0) { console.log('  ALLE ' + pass + ' PRÜFUNGEN IM ECHTEN BROWSER BESTANDEN'); }
  else {
    console.log('  ' + pass + ' bestanden, ' + fail + ' DURCHGEFALLEN:\n');
    failures.forEach(f => console.log('   ✗ ' + f));
  }
  console.log('  Bilder: test/ausgabe/');
  console.log('  ' + '='.repeat(56) + '\n');
  process.exit(fail === 0 ? 0 : 1);
}()).catch(e => {
  console.log('\n  ABBRUCH: ' + e.message);
  console.log((e.stack || '').split('\n').slice(1, 5).join('\n'));
  process.exit(1);
});
