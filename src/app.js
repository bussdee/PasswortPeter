/* PasswortPeter – Anwendung (v1.0)
 *
 * Läuft als klassisches <script> unter file://. Keine Module, kein Netz,
 * kein Browser-Speicher. Was hier im Arbeitsspeicher liegt, ist alles.
 *
 * Drei Regeln, die im ganzen Code gelten:
 *   1. Fremder Text geht nie über innerHTML. Nur textContent.
 *   2. Adressen gehen nur durch PPVault.safeUrl in ein href oder window.open.
 *   3. Jeder sichtbare Text kommt aus PPI18n (Deutsch, Englisch).
 */
(function () {
  'use strict';

  var APP_VERSION = '1.0.0';

  var V = window.PPVault;
  var Seal = window.PPSeal;
  var I18N = window.PPI18n;
  var t = I18N.t, tn = I18N.tn;

  var COUNTDOWN_MS = 90 * 1000;
  var ABLAGE_LEEREN_MS = 20 * 1000;
  var VERSTECKT_SPERRE_MS = 45 * 1000;   // im Hintergrund schneller zusperren

  /* ------------------------------------------------------------- Zustand */

  var Z = {
    daten: null,        // entschlüsselter Tresor
    passwort: null,     // Master-Passwort, nur im Arbeitsspeicher
    kdf: null,
    dateiname: 'Tresor',
    dateiHandle: null,  // FileSystemFileHandle, falls der Browser das kann
    schmutzig: false,   // ungespeicherte Änderungen
    rohdatei: null,     // geladene Bytes, warten auf das Passwort
    suche: '',
    ansicht: 'start',   // start | alle | fav | zuletzt | kat | ohne | tag | papierkorb | sicherheit
    kategorie: null,
    tag: null,
    sortierung: 'name', // name | benutzt | neu | eigen
    darstellung: 'kacheln',
    auswahl: null,      // null = aus, sonst { id: true }
    bannerWeg: {},      // für diese Sitzung weggeklickte Hinweise
    fehlversuche: 0,    // nur im Arbeitsspeicher, siehe aufbauenAufschliessen
    sperreBis: 0,
    ruheUhr: null,
    verstecktUhr: null,
    countdownUhr: null,
    ablageUhr: null,
    zurufUhr: null,
    ziehId: null
  };

  /* Kann dieser Browser eine Datei an Ort und Stelle überschreiben? Nur dann
   * gibt es das Speichern ohne neuen Download. Firefox und die meisten
   * Handy-Browser können es nicht, dort bleibt es beim Download. */
  var KANN_UEBERSCHREIBEN = (typeof window.showSaveFilePicker === 'function');
  var KANN_OEFFNEN_MIT_HANDLE = (typeof window.showOpenFilePicker === 'function');

  /* ------------------------------------------------------ Kleine Werkzeuge */

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, kinder) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) { return; }
        if (k === 'text') { n.textContent = v; }
        else if (k === 'html') { n.innerHTML = v; }          // nur für selbst erzeugte SVG
        else if (k === 'stil') { n.setAttribute('style', v); }
        else if (k.slice(0, 2) === 'on') { n.addEventListener(k.slice(2), v); }
        else { n.setAttribute(k, v === true ? '' : String(v)); }
      });
    }
    (kinder || []).forEach(function (k) {
      if (k === null || k === undefined || k === false) { return; }
      n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return n;
  }

  function leeren(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }

  function jetzt() { return new Date().toISOString(); }

  /* Symbole, alle selbst gezeichnet, 24er Raster, Strich. */
  var ZEICHEN = {
    welt: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    extern: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    schluessel: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M17 6l2 2M14.5 8.5l2 2"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    stern: '<path d="M12 3.2l2.7 5.5 6.1.9-4.4 4.3 1 6L12 17l-5.4 2.9 1-6-4.4-4.3 6.1-.9z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    stift: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    auge: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
    augeZu: '<path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    wuerfel: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>',
    feder: '<path d="M20 4C13 4 8 8 6 15l-2 5 5-2c7-2 11-7 11-14z"/><path d="M6 20L14 12"/>',
    regler: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    zurueck: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>',
    muell: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
    schild: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
    schildOk: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    kopieren: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    haus: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    stapel: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/>',
    uhr: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ordner: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    tag: '<path d="M4 12V4h8l8 8-8 8z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
    import: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    drucken: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>',
    zahnrad: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".9" fill="currentColor"/>',
    schloss: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    mehr: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
    menue: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    lupe: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    kacheln: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    liste: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="18" r="1" fill="currentColor"/>',
    sortieren: '<path d="M7 4v16M4 7l3-3 3 3"/><path d="M17 20V4M14 17l3 3 3-3"/>',
    haken: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    wahl: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    kreuz: '<path d="M6 6l12 12M18 6L6 18"/>',
    hoch: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    runter: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    links: '<path d="M15 6l-6 6 6 6"/>',
    rechts: '<path d="M9 6l6 6-6 6"/>',
    griff: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
    sicherung: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.3 1.5A3.8 3.8 0 0 1 17.5 18z"/><path d="M12 11v5M9.8 13.2L12 11l2.2 2.2"/>',
    lesezeichen: '<path d="M6 4h12v16l-6-4-6 4z"/>',
    zettel: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    sprache: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z"/>'
  };

  function zeichen(name, gefuellt) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', gefuellt ? 'currentColor' : 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.innerHTML = ZEICHEN[name] || '';
    return s;
  }

  var LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="1" y="1" width="30" height="30" rx="9" fill="var(--akzent)"/>' +
    '<circle cx="16" cy="12.6" r="4.6" fill="none" stroke="var(--auf-akzent)" stroke-width="2.6"/>' +
    '<path d="M16 17.2v8M16 21.4h3.6M16 24.6h2.4" fill="none" stroke="var(--auf-akzent)" stroke-width="2.6" stroke-linecap="round"/></svg>';

  function siegel(klasse, seed, label) {
    return el('div', { 'class': klasse, html: Seal.svg(seed, label) });
  }

  function katVon(it) {
    if (!it.cat) { return null; }
    for (var i = 0; i < Z.daten.categories.length; i++) {
      if (Z.daten.categories[i].id === it.cat) { return Z.daten.categories[i]; }
    }
    return null;
  }

  function titelVon(it) { return it.title || V.hostOf(it.url) || t('allg.ohneTitel'); }

  /* Das Erkennungszeichen einer Karte: eigenes Emoji auf eigener Farbe, sonst
   * das Siegel aus dem Namen der Seite. */
  function symbolBauen(it, klasse) {
    var host = V.hostOf(it.url);
    var cat = katVon(it);
    var farbe = it.color || (cat ? cat.color : '');
    if (it.emoji) {
      return el('div', {
        'class': klasse + ' symbol symbol--emoji' + (farbe ? ' symbol--farbig' : ''),
        stil: farbe ? '--f:var(--kat-' + farbe + ')' : ''
      }, [el('span', { text: it.emoji })]);
    }
    return el('div', { 'class': klasse + ' symbol', html: Seal.svg(host || it.title || '?', it.title || host) });
  }

  /* ------------------------------------------------------ Zurufe (Toasts) */

  function zuruf(text, warn) {
    var halter = $('zuruf-halter');
    leeren(halter);
    clearTimeout(Z.zurufUhr);
    halter.appendChild(el('div', {
      'class': 'zuruf' + (warn ? ' zuruf--warn' : ''),
      role: 'status', 'aria-live': 'polite', text: text
    }));
    Z.zurufUhr = setTimeout(function () { leeren(halter); }, warn ? 4200 : 2800);
  }

  /* Wie zuruf, aber mit einem Zurück-Knopf. Für Löschungen: ein Griff genügt,
   * um sie sofort rückgängig zu machen, ohne den Umweg über den Papierkorb. */
  function zurufMitZurueck(text, zurueck) {
    var halter = $('zuruf-halter');
    leeren(halter);
    clearTimeout(Z.zurufUhr);
    var knopf = el('button', {
      'class': 'zuruf__zurueck', text: t('muell.zurueckholen'),
      onclick: function () { leeren(halter); zurueck(); }
    });
    halter.appendChild(el('div', { 'class': 'zuruf zuruf--tat', role: 'status' }, [
      el('span', { text: text }), knopf
    ]));
    Z.zurufUhr = setTimeout(function () { leeren(halter); }, 6500);
  }

  function zeige(id) {
    ['s-start', 's-neu', 's-auf', 's-app'].forEach(function (s) {
      $(s).classList.toggle('versteckt', s !== id);
    });
  }

  /* ------------------------------------------------- Sprache und Aussehen */

  function statischUebersetzen() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (n) { n.textContent = t(n.getAttribute('data-t')); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-t-ph]'), function (n) { n.setAttribute('placeholder', t(n.getAttribute('data-t-ph'))); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-t-aria]'), function (n) { n.setAttribute('aria-label', t(n.getAttribute('data-t-aria'))); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-t-title]'), function (n) { n.setAttribute('title', t(n.getAttribute('data-t-title'))); });
    document.body.setAttribute('data-druck-hinweis', t('nz.druckHinweis'));
    document.documentElement.setAttribute('lang', I18N.lang());
  }

  function spracheSetzen(l) {
    I18N.setLang(l);
    statischUebersetzen();
    startSpracheZeichnen();
    if (Z.daten && !$('s-app').classList.contains('versteckt')) { zeichnen(); modusZeigen(); schmutzig(Z.schmutzig); }
  }

  /* Auswahl DE | EN auf dem Startschirm. Gilt nur für diese Sitzung; im
   * Tresor gespeichert wird die Sprache über die Einstellungen. */
  function startSpracheZeichnen() {
    var h = $('start-sprache');
    if (!h) { return; }
    leeren(h);
    I18N.SPRACHEN.forEach(function (l) {
      h.appendChild(el('button', {
        'class': 'sprachwahl__knopf' + (I18N.lang() === l ? ' sprachwahl__knopf--an' : ''),
        'aria-pressed': I18N.lang() === l ? 'true' : 'false',
        text: l.toUpperCase(),
        onclick: function () { spracheSetzen(l); }
      }));
    });
  }

  function themaAnwenden(thema) {
    if (thema === 'hell' || thema === 'dunkel') { document.documentElement.setAttribute('data-theme', thema); }
    else { document.documentElement.removeAttribute('data-theme'); }
  }

  /* ------------------------------------------------- Zwischenablage */

  function kopiere(text, was) {
    var fertig = function () {
      zuruf(t('ablage.kopiert', { was: was, n: ABLAGE_LEEREN_MS / 1000 }));
      clearTimeout(Z.ablageUhr);
      Z.ablageUhr = setTimeout(leereAblage, ABLAGE_LEEREN_MS);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(fertig, function () {
        if (altKopieren(text)) { fertig(); } else { zuruf(t('ablage.verweigert'), true); }
      });
    } else if (altKopieren(text)) { fertig(); }
    else { zuruf(t('ablage.verweigert'), true); }
  }

  /* Weg für Browser, die navigator.clipboard unter file:// verweigern. */
  function altKopieren(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function leereAblage() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('').catch(function () { altKopieren(''); });
    } else { altKopieren(''); }
  }

  /* ------------------------------------------------- Ruhe und Sperre */

  function sperreMs() {
    var min = (Z.daten && Z.daten.settings) ? Z.daten.settings.autoLockMin : 5;
    if (min === 0) { return 0; }   // nie
    return (min || 5) * 60 * 1000;
  }

  function ruheAnstossen() {
    clearTimeout(Z.ruheUhr);
    if (!Z.daten) { return; }
    var ms = sperreMs();
    if (ms === 0) { return; }
    Z.ruheUhr = setTimeout(ruheAbgelaufen, ms);
  }

  function ruheAbgelaufen() {
    if (!Z.daten) { return; }
    if (!Z.schmutzig) { sperren(); return; }
    countdownZeigen();
  }

  function countdownZeigen() {
    var rest = Math.round(COUNTDOWN_MS / 1000);
    var zahl = el('strong', { text: String(rest) });
    var blatt = blattBauen({
      titel: t('sperre.titel'), rolle: 'alertdialog', schmal: true, ohneZu: true,
      leib: [
        el('p', { 'class': 'absatz' }, [t('sperre.text1'), zahl, t('sperre.text2')]),
        el('p', { 'class': 'absatz leise klein', text: t('sperre.hinweis') })
      ],
      fuss: [
        el('button', { 'class': 'knopf', text: t('sperre.weiter'), onclick: function () { vorhangZu(); ruheAnstossen(); } }),
        el('button', {
          'class': 'knopf knopf--haupt', text: t('sperre.speichernSperren'),
          onclick: function () { vorhangZu(); speichern().then(function (ok) { if (ok) { sperren(); } }); }
        })
      ]
    });
    vorhangAuf(blatt, false);
    clearInterval(Z.countdownUhr);
    Z.countdownUhr = setInterval(function () {
      rest--;
      zahl.textContent = String(Math.max(0, rest));
      if (rest <= 0) { clearInterval(Z.countdownUhr); vorhangZu(); sperren(); }
    }, 1000);
  }

  function sperren() {
    clearInterval(Z.countdownUhr);
    clearTimeout(Z.ruheUhr);
    clearTimeout(Z.verstecktUhr);
    leereAblage();
    Z.daten = null;
    Z.passwort = null;
    Z.kdf = null;
    Z.dateiHandle = null;
    Z.schmutzig = false;
    Z.suche = '';
    Z.ansicht = 'start';
    Z.kategorie = null;
    Z.tag = null;
    Z.sortierung = 'name';
    Z.auswahl = null;
    Z.bannerWeg = {};
    $('suche').value = '';
    navZu();
    vorhangZu();
    leeren($('inhalt'));
    leeren($('nav'));
    $('auswahl-leiste').classList.add('versteckt');
    themaAnwenden('auto');
    zeige('s-start');
    $('start-fehler').classList.add('versteckt');
    zuruf(t('sperre.zugesperrt'));
  }

  function schmutzig(ja) {
    Z.schmutzig = ja;
    var st = $('leiste-status');
    if (st) {
      st.textContent = ja ? t('leiste.ungespeichert') : t('leiste.gespeichert');
      st.classList.toggle('seite__status--schmutzig', ja);
    }
    var b = $('b-speichern');
    if (b) {
      b.classList.toggle('knopf--schmutzig', ja);
      b.setAttribute('aria-label', t('leiste.speichern') + (ja ? ' – ' + t('leiste.ungespeichert') : ''));
    }
  }

  /* ------------------------------------------------- Datei einlesen */

  function dateiLesen(datei, handle) {
    if (!datei) { return; }
    if (datei.size > 40 * 1024 * 1024) {
      startFehler(t('start.zuGross'));
      return;
    }
    var leser = new FileReader();
    leser.onerror = function () { startFehler(t('start.unlesbar')); };
    leser.onload = function () {
      var bytes = new Uint8Array(leser.result);
      var kopf;
      try { kopf = V.readHeader(bytes); }
      catch (e) { startFehler(kernFehler(e)); return; }
      Z.rohdatei = bytes;
      Z.dateiname = datei.name.replace(/\.peter$/i, '') || 'Tresor';
      Z.dateiHandle = handle || null;   // nur der Dateiwähler liefert ein Handle
      Z.kdf = { ops: kopf.ops, memKiB: kopf.memKiB };
      aufbauenAufschliessen();
    };
    leser.readAsArrayBuffer(datei);
  }

  /* Übersetzt Fehler aus dem Kern über ihre Kennung. */
  function kernFehler(e) {
    if (e && e.code) {
      var text = t('kern.' + e.code);
      if (text !== 'kern.' + e.code) { return text; }
    }
    return (e && e.message) ? e.message : String(e);
  }

  /* Öffnen über den Dateiwähler des Browsers. Nur dieser Weg liefert ein
   * Handle, mit dem später dieselbe Datei überschrieben werden kann. Kann der
   * Browser das nicht, wird der klassische Dateidialog benutzt. */
  async function dateiWaehlen() {
    if (KANN_OEFFNEN_MIT_HANDLE) {
      try {
        var ergebnis = await window.showOpenFilePicker({
          types: [{ description: t('sp.typ'), accept: { 'application/octet-stream': ['.peter'] } }],
          multiple: false
        });
        var handle = ergebnis[0];
        var datei = await handle.getFile();
        dateiLesen(datei, handle);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { return; }
        /* sonst auf den klassischen Dialog zurückfallen */
      }
    }
    $('b-datei').click();
  }

  function startFehler(text) {
    var f = $('start-fehler');
    f.textContent = text;
    f.classList.remove('versteckt');
  }

  /* ------------------------------------------------- Stärkeanzeige */

  function staerkeBauen() {
    var teile = [], i;
    for (i = 0; i < 4; i++) { teile.push(el('div', { 'class': 'staerke__teil' })); }
    var wort = el('span', { 'class': 'staerke__wort' });
    var n = el('div', { 'class': 'staerke' }, [el('div', { 'class': 'staerke__spur' }, teile), wort]);
    var FARBEN = ['var(--rot)', 'var(--rot)', 'var(--gelb)', 'var(--gruen)', 'var(--gruen)'];
    return {
      knoten: n,
      zeigen: function (pw) {
        var r = V.ratePassword(pw);
        wort.textContent = pw ? t('staerke.' + r.stufe) + ' · ' + t('allg.bit', { n: r.bits }) : '';
        teile.forEach(function (tt, idx) {
          tt.classList.toggle('staerke__teil--an', !!pw && idx < Math.max(1, r.stufe));
          tt.style.setProperty('--f', FARBEN[r.stufe]);
        });
        return r;
      }
    };
  }

  /* ------------------------------------------------- Bildschirm: Aufsperren
   *
   * Fehlversuche bremsen: ab dem dritten falschen Passwort in dieser Sitzung
   * wächst eine Wartezeit (5, 10, 20, dann 30 s). Ehrlich gesagt schützt das
   * nur vor dem Raten von Hand an diesem Bildschirm. Wer die Datei kopiert,
   * rät ohne diese Oberfläche; gegen ihn hilft allein Argon2id im Dateikopf.
   * Einen Zähler über ein Neuladen hinaus gibt es bewusst nicht: dafür müsste
   * der Browser etwas speichern, und das tut diese Datei nie. */

  function wartezeitMs() {
    if (Z.fehlversuche < 3) { return 0; }
    return Math.min(30, 5 * Math.pow(2, Z.fehlversuche - 3)) * 1000;
  }

  function aufbauenAufschliessen() {
    var halter = $('auf-mitte');
    leeren(halter);

    var fehler = el('div', { 'class': 'warnung versteckt', role: 'alert' });
    var eingabe = el('input', {
      'class': 'eingabe eingabe--gross', type: 'password', id: 'auf-pw',
      autocomplete: 'current-password', placeholder: t('auf.pwPh'), 'aria-label': t('auf.pwPh')
    });
    var augeKnopf = el('button', { 'class': 'symbolknopf eingabe__knopf', type: 'button', title: t('edit.zeigen'), 'aria-label': t('edit.zeigen') }, [zeichen('auge')]);
    augeKnopf.addEventListener('click', function () {
      var zu = eingabe.type === 'password';
      eingabe.type = zu ? 'text' : 'password';
      augeKnopf.replaceChildren(zeichen(zu ? 'augeZu' : 'auge'));
    });
    var riegel = el('div', { 'class': 'riegel versteckt' }, [el('div', { 'class': 'riegel__lauf' })]);
    var knopf = el('button', { 'class': 'knopf knopf--haupt knopf--weit', id: 'b-aufsperren', text: t('auf.knopf') });
    var uhr = null;

    function wartenZeigen() {
      clearInterval(uhr);
      var bis = Z.sperreBis;
      if (Date.now() >= bis) { knopf.disabled = false; knopf.textContent = t('auf.knopf'); return; }
      knopf.disabled = true;
      var tick = function () {
        var rest = Math.ceil((bis - Date.now()) / 1000);
        if (rest <= 0 || !document.body.contains(knopf)) {
          clearInterval(uhr); knopf.disabled = false; knopf.textContent = t('auf.knopf'); return;
        }
        knopf.textContent = t('auf.wartenKnopf', { n: rest });
      };
      tick();
      uhr = setInterval(tick, 250);
    }

    var laeuft = false;
    function versuchen() {
      if (laeuft) { return; }
      if (Date.now() < Z.sperreBis) { return; }
      var pw = eingabe.value;
      if (!pw) { return; }
      laeuft = true;
      fehler.classList.add('versteckt');
      riegel.classList.remove('versteckt');
      knopf.disabled = true; eingabe.disabled = true;
      knopf.textContent = t('allg.rechnet');

      /* Zwei Bilder Pause, damit der Riegel wirklich zu sehen ist, bevor
       * Argon2id den Hauptstrang für ein bis vier Sekunden blockiert. */
      setTimeout(function () {
        var ergebnis;
        try {
          ergebnis = V.decrypt(Z.rohdatei, pw);
        } catch (e) {
          laeuft = false;
          riegel.classList.add('versteckt');
          eingabe.disabled = false;
          knopf.disabled = false;
          knopf.textContent = t('auf.knopf');
          var text = kernFehler(e);
          if (e && e.code === 'passwort') {
            Z.fehlversuche++;
            var ms = wartezeitMs();
            if (ms > 0) {
              Z.sperreBis = Date.now() + ms;
              text += ' ' + t('auf.warten', { n: Math.round(ms / 1000) });
              wartenZeigen();
            }
          }
          fehler.textContent = text;
          fehler.classList.remove('versteckt');
          eingabe.value = '';
          eingabe.focus();
          return;
        }
        Z.fehlversuche = 0;
        Z.sperreBis = 0;
        Z.daten = ergebnis.data;
        Z.kdf = ergebnis.kdf;
        Z.passwort = pw;
        Z.rohdatei = null;
        eingabe.value = '';
        appAufbauen();
      }, 40);
    }

    knopf.addEventListener('click', versuchen);
    eingabe.addEventListener('keydown', function (e) { if (e.key === 'Enter') { versuchen(); } });

    halter.appendChild(el('div', { 'class': 'tafel__oben' }, [
      siegel('tafel__siegel', Z.dateiname, Z.dateiname),
      el('p', { 'class': 'etikett', text: t('auf.marke') }),
      el('h1', { 'class': 'tafel__titel tafel__titel--mitte', text: Z.dateiname }),
      el('p', { 'class': 'leise klein mono', text: t('auf.kdf', { mib: Math.round(Z.kdf.memKiB / 1024), ops: Z.kdf.ops }) })
    ]));
    halter.appendChild(el('div', { 'class': 'eingabe-mit-knopf' }, [eingabe, augeKnopf]));
    halter.appendChild(riegel);
    halter.appendChild(knopf);
    halter.appendChild(fehler);
    halter.appendChild(el('button', {
      'class': 'knopf knopf--leise knopf--weit', text: t('auf.andere'),
      onclick: function () { Z.rohdatei = null; zeige('s-start'); }
    }));

    zeige('s-auf');
    if (Date.now() < Z.sperreBis) { wartenZeigen(); }
    setTimeout(function () { eingabe.focus(); }, 30);
  }

  /* ------------------------------------------------- Bildschirm: Neu */

  function aufbauenNeu() {
    var halter = $('neu-mitte');
    leeren(halter);

    var name = el('input', { 'class': 'eingabe', type: 'text', placeholder: t('neu.namePh'), maxlength: '60', id: 'neu-name' });
    var pw1 = el('input', { 'class': 'eingabe', type: 'password', autocomplete: 'new-password', placeholder: t('neu.pwPh'), id: 'neu-pw1' });
    var pw2 = el('input', { 'class': 'eingabe', type: 'password', autocomplete: 'new-password', placeholder: t('neu.pw2Ph'), id: 'neu-pw2' });
    var fehler = el('div', { 'class': 'warnung versteckt', role: 'alert' });
    var riegel = el('div', { 'class': 'riegel versteckt' }, [el('div', { 'class': 'riegel__lauf' })]);
    var knopf = el('button', { 'class': 'knopf knopf--haupt knopf--weit', text: t('neu.anlegen'), id: 'b-anlegen' });
    var staerke = staerkeBauen();
    pw1.addEventListener('input', function () { staerke.zeigen(pw1.value); });

    function fehlerZeigen(text) { fehler.textContent = text; fehler.classList.remove('versteckt'); }

    var laeuft = false;
    knopf.addEventListener('click', function () {
      if (laeuft) { return; }
      fehler.classList.add('versteckt');
      var n = name.value.trim();
      if (!n) { fehlerZeigen(t('neu.fehlerName')); return; }
      if (pw1.value.length < 12) { fehlerZeigen(t('neu.fehlerKurz')); return; }
      if (pw1.value !== pw2.value) { fehlerZeigen(t('neu.fehlerGleich')); return; }
      if (V.ratePassword(pw1.value).stufe < 2) { fehlerZeigen(t('neu.fehlerSchwach')); return; }

      laeuft = true;
      riegel.classList.remove('versteckt');
      knopf.disabled = true;
      knopf.textContent = t('allg.rechnet');

      setTimeout(function () {
        Z.daten = V.emptyVault(n);
        Z.daten.settings.lang = I18N.lang();
        Z.passwort = pw1.value;
        Z.kdf = geraeteKdf();
        Z.dateiname = n;
        Z.dateiHandle = null;
        Z.daten.categories.push(V.newCategory(t('neu.ersterReiter'), 'messing'));
        pw1.value = ''; pw2.value = '';
        appAufbauen();
        schmutzig(true);
        speichern();
      }, 40);
    });

    halter.appendChild(el('p', { 'class': 'etikett', text: t('neu.marke') }));
    halter.appendChild(el('h1', { 'class': 'tafel__titel', text: t('neu.titel') }));
    halter.appendChild(feld(t('neu.name'), name));
    halter.appendChild(feld(t('neu.pw'), pw1, [staerke.knoten]));
    halter.appendChild(el('button', {
      'class': 'knopf knopf--leise knopf--klein', type: 'button',
      onclick: function () {
        var vorschlag = V.generatePassphrase({ words: 6 });
        pw1.value = vorschlag; pw2.value = vorschlag;
        pw1.type = 'text'; pw2.type = 'text';
        staerke.zeigen(vorschlag);
        zuruf(t('neu.merksatzZuruf', { n: V.passphraseBits({ words: 6 }) }));
      }
    }, [zeichen('feder'), t('neu.merksatz')]));
    halter.appendChild(feld(t('neu.pw2'), pw2));
    halter.appendChild(el('div', { 'class': 'hinweis hinweis--warn' }, [
      zeichen('warn'),
      el('p', {}, [el('strong', { text: t('neu.keineWiederherstellung') }), ' ' + t('neu.keineWiederherstellungText')])
    ]));
    halter.appendChild(riegel);
    halter.appendChild(knopf);
    halter.appendChild(fehler);
    halter.appendChild(el('button', { 'class': 'knopf knopf--leise knopf--weit', text: t('allg.zurueck'), onclick: function () { zeige('s-start'); } }));

    zeige('s-neu');
    setTimeout(function () { name.focus(); }, 30);
  }

  /* Ein Formularfeld: Beschriftung, Eingabe, optional Zusätze darunter. */
  function feld(name, eingabe, zusatz, hinweis) {
    var id = eingabe.id || ('f-' + Math.random().toString(36).slice(2, 9));
    if (!eingabe.id && eingabe.tagName !== 'DIV') { eingabe.id = id; }
    var kinder = [el('label', { 'class': 'feld__name', 'for': eingabe.tagName === 'DIV' ? null : eingabe.id, text: name })];
    if (hinweis) { kinder[0].appendChild(el('span', { 'class': 'feld__hinweis', text: ' · ' + hinweis })); }
    kinder.push(eingabe);
    (zusatz || []).forEach(function (z) { kinder.push(z); });
    return el('div', { 'class': 'feld' }, kinder);
  }

  /* Wählt die Argon2id-Parameter. Grundlage ist die Einstellung des Tresors
   * (sparsam, standard, streng). Schafft das Gerät die gewählte Stärke nicht,
   * wird auf die nächstschwächere ausgewichen, statt am Speicher zu scheitern.
   * Die Parameter landen im Dateikopf, jedes andere Gerät öffnet den Tresor
   * trotzdem. */
  function geraeteKdf() {
    var wahl = (Z.daten && Z.daten.settings) ? Z.daten.settings.kdf : 'standard';
    var kette = wahl === 'streng' ? ['streng', 'standard', 'sparsam']
              : wahl === 'sparsam' ? ['sparsam']
              : ['standard', 'sparsam'];
    for (var i = 0; i < kette.length; i++) {
      var k = V.kdfVon(kette[i]);
      try {
        window.sodium.crypto_pwhash(32, 'probe', window.sodium.randombytes_buf(16), k.ops, k.memKiB * 1024, window.sodium.crypto_pwhash_ALG_ARGON2ID13);
        return k;
      } catch (e) { /* nächstschwächere versuchen */ }
    }
    return V.KDF_SPARSAM;
  }

  /* ------------------------------------------------- Speichern
   *
   * Zwei Wege. Kann der Browser eine Datei an Ort und Stelle überschreiben
   * (Chrome, Edge, Opera am Rechner), dann bleibt es bei einer einzigen
   * .peter-Datei, die immer wieder überschrieben wird. Kann er es nicht
   * (Firefox, fast alle Handys), dann lädt er eine neue Datei herunter. Beide
   * Wege sind gleich sicher, der Unterschied ist nur der Komfort.
   */

  function sauberName() {
    return (Z.daten.name || 'Tresor').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Tresor';
  }

  function baueBytes() {
    return V.encrypt(Z.daten, Z.passwort, Z.kdf);
  }

  function herunterladen(inhalt, typ, dateiname) {
    var blob = new Blob([inhalt], { type: typ });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: dateiname });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  async function speichern() {
    if (!Z.daten || !Z.passwort) { return false; }
    var bytes;
    try { bytes = baueBytes(); }
    catch (e) { zuruf(t('sp.fehlgeschlagen', { text: kernFehler(e) }), true); return false; }

    /* Weg 1: in dieselbe Datei zurückschreiben. */
    if (Z.dateiHandle) {
      try {
        if (!(await handleSchreibbar(Z.dateiHandle))) {
          zuruf(t('sp.abgelehnt'), true);
          return false;
        }
        var w = await Z.dateiHandle.createWritable();
        await w.write(bytes);
        await w.close();
        schmutzig(false);
        zuruf(t('sp.inDatei'));
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') { return false; }
        /* Wenn das Zurückschreiben scheitert, nicht einfach aufgeben,
         * sondern auf den Download zurückfallen. Lieber ein Download zu viel
         * als eine verlorene Änderung. */
        Z.dateiHandle = null;
      }
    }

    /* Weg 1b: einmal fragen, wohin, und die Datei ab dann merken. */
    if (KANN_UEBERSCHREIBEN && !Z.dateiHandle) {
      try {
        var handle = await window.showSaveFilePicker({
          suggestedName: sauberName() + '.peter',
          types: [{ description: t('sp.typ'), accept: { 'application/octet-stream': ['.peter'] } }]
        });
        var w2 = await handle.createWritable();
        await w2.write(bytes);
        await w2.close();
        Z.dateiHandle = handle;
        Z.dateiname = handle.name.replace(/\.peter$/i, '') || Z.dateiname;
        schmutzig(false);
        modusZeigen();
        zuruf(t('sp.ersteMal'));
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') { return false; }   // abgebrochen
        /* sonst weiter zum Download */
      }
    }

    /* Weg 2: Download. */
    try { herunterladen(bytes, 'application/octet-stream', sauberName() + '.peter'); }
    catch (e) { zuruf(t('sp.downloadVerweigert'), true); return false; }
    schmutzig(false);
    zuruf(t('sp.download', { datei: sauberName() + '.peter' }));
    return true;
  }

  async function handleSchreibbar(handle) {
    if (!handle.queryPermission) { return true; }
    var opt = { mode: 'readwrite' };
    if ((await handle.queryPermission(opt)) === 'granted') { return true; }
    return (await handle.requestPermission(opt)) === 'granted';
  }

  /* Zeigt am Speichern-Knopf, ob in eine feste Datei gespeichert wird oder
   * heruntergeladen. Das nimmt die Überraschung aus dem Knopf. */
  function modusZeigen() {
    var b = $('b-speichern');
    if (!b) { return; }
    if (Z.dateiHandle) { b.setAttribute('title', t('leiste.modusHandle', { name: Z.dateiHandle.name })); }
    else if (KANN_UEBERSCHREIBEN) { b.setAttribute('title', t('leiste.modusFragen')); }
    else { b.setAttribute('title', t('leiste.modusDownload')); }
  }

  /* Sicherungskopie: dieselbe verschlüsselte Datei unter einem Namen mit
   * Datum, als Download. Für einen zweiten Ort, etwa einen USB-Stick. */
  function sicherungHerunterladen() {
    if (!Z.daten) { return false; }
    Z.daten.settings.lastBackupAt = jetzt();
    var datei = sauberName() + '_Sicherung_' + jetzt().slice(0, 10) + '.peter';
    try { herunterladen(baueBytes(), 'application/octet-stream', datei); }
    catch (e) { zuruf(t('sp.downloadVerweigert'), true); return false; }
    /* Das Datum der Sicherung gehört auch in die Hauptdatei. */
    schmutzig(true);
    zeichnen();
    zuruf(t('sicherung.fertig', { datei: datei }));
    return true;
  }

  function lesezeichenExportieren() {
    var datei = sauberName() + '_Lesezeichen.html';
    try { herunterladen(V.exportBookmarksHtml(Z.daten), 'text/html;charset=utf-8', datei); }
    catch (e) { zuruf(t('sp.downloadVerweigert'), true); return false; }
    zuruf(t('lz.fertig', { datei: datei }));
    return true;
  }

  /* ------------------------------------------------- Der Tresor */

  function appAufbauen() {
    var s = Z.daten.settings || V.defaultSettings();
    I18N.setLang(s.lang);
    statischUebersetzen();
    themaAnwenden(s.theme);
    Z.darstellung = s.view;
    zeige('s-app');
    $('leiste-siegel-halter').replaceChildren(siegel('seite__siegelbild', Z.daten.name, Z.daten.name));
    $('leiste-name').textContent = Z.daten.name;
    schmutzig(Z.schmutzig);
    modusZeigen();
    zeichnen();
    ruheAnstossen();
  }

  function zeichnen() {
    if (!Z.daten) { return; }
    navZeichnen();
    bannerZeichnen();
    inhaltZeichnen();
    auswahlLeisteZeichnen();
  }

  /* ------------------------------------------------- Navigation */

  function geheZu(ansicht, wert) {
    Z.ansicht = ansicht;
    Z.kategorie = ansicht === 'kat' ? wert : null;
    Z.tag = ansicht === 'tag' ? wert : null;
    if (Z.suche) { Z.suche = ''; $('suche').value = ''; }
    navZu();
    zeichnen();
    var inh = $('inhalt');
    if (inh && inh.scrollTo) { inh.scrollTo(0, 0); }
  }

  function navAuf() { $('seite').classList.add('seite--offen'); $('nav-schleier').classList.remove('versteckt'); }
  function navZu() { $('seite').classList.remove('seite--offen'); $('nav-schleier').classList.add('versteckt'); }

  function navZeichnen() {
    var nav = $('nav');
    leeren(nav);

    var lebend = Z.daten.items.filter(function (it) { return !it.deletedAt; });
    var zaehler = Object.create(null);
    lebend.forEach(function (it) { if (it.cat) { zaehler[it.cat] = (zaehler[it.cat] || 0) + 1; } });
    var ohne = lebend.filter(function (it) { return !it.cat; }).length;
    var favs = lebend.filter(function (it) { return it.fav; }).length;
    var muell = V.trashList(Z.daten).length;
    var audit = V.audit(Z.daten);

    function eintrag(o) {
      var aktiv = !!o.aktiv;
      return el('button', {
        'class': 'nav__eintrag' + (aktiv ? ' nav__eintrag--aktiv' : ''),
        'aria-current': aktiv ? 'page' : null,
        'data-nav': o.schluessel || null,
        onclick: o.klick
      }, [
        o.farbe ? el('span', { 'class': 'nav__punkt', stil: '--f:' + o.farbe }) : el('span', { 'class': 'nav__symbol' }, [zeichen(o.symbol || 'ordner')]),
        el('span', { 'class': 'nav__text', text: o.text }),
        o.marke ? o.marke : (o.anzahl !== undefined ? el('span', { 'class': 'nav__zahl', text: String(o.anzahl) }) : null)
      ]);
    }
    function gruppe(titel, kinder, tun) {
      var kopf = el('div', { 'class': 'nav__kopf' }, [el('span', { text: titel }), tun || null]);
      return el('div', { 'class': 'nav__gruppe' }, [kopf].concat(kinder));
    }

    var A = Z.ansicht;
    nav.appendChild(el('div', { 'class': 'nav__gruppe' }, [
      eintrag({ text: t('nav.uebersicht'), symbol: 'haus', schluessel: 'start', aktiv: A === 'start', klick: function () { geheZu('start'); } }),
      eintrag({ text: t('nav.alle'), symbol: 'stapel', schluessel: 'alle', anzahl: lebend.length, aktiv: A === 'alle', klick: function () { geheZu('alle'); } }),
      eintrag({ text: t('nav.favoriten'), symbol: 'stern', schluessel: 'fav', anzahl: favs, aktiv: A === 'fav', klick: function () { geheZu('fav'); } }),
      eintrag({ text: t('nav.zuletzt'), symbol: 'uhr', schluessel: 'zuletzt', aktiv: A === 'zuletzt', klick: function () { geheZu('zuletzt'); } })
    ]));

    var kats = Z.daten.categories.slice().sort(function (a, b) { return a.order - b.order; }).map(function (c) {
      return eintrag({
        text: c.name || t('allg.ohneName'), farbe: 'var(--kat-' + c.color + ')', anzahl: zaehler[c.id] || 0,
        schluessel: 'kat:' + c.id, aktiv: A === 'kat' && Z.kategorie === c.id, klick: function () { geheZu('kat', c.id); }
      });
    });
    if (ohne > 0 && Z.daten.categories.length > 0) {
      kats.push(eintrag({ text: t('nav.ohneReiter'), farbe: 'var(--linie-stark)', anzahl: ohne, schluessel: 'ohne', aktiv: A === 'ohne', klick: function () { geheZu('ohne'); } }));
    }
    nav.appendChild(gruppe(t('nav.reiter'), kats, el('button', {
      'class': 'nav__kopfknopf', title: t('nav.reiterVerwalten'), 'aria-label': t('nav.reiterVerwalten'), onclick: function () { navZu(); reiterVerwalten(); }
    }, [zeichen('regler')])));

    var tags = V.allTags(Z.daten);
    if (tags.length) {
      nav.appendChild(gruppe(t('nav.schlagwoerter'), [el('div', { 'class': 'nav__tags' }, tags.map(function (x) {
        var aktiv = A === 'tag' && Z.tag && Z.tag.toLowerCase() === x.tag.toLowerCase();
        return el('button', {
          'class': 'chip' + (aktiv ? ' chip--an' : ''), 'aria-pressed': aktiv ? 'true' : 'false',
          onclick: function () { geheZu('tag', x.tag); }
        }, ['#' + x.tag, el('span', { 'class': 'chip__zahl', text: String(x.count) })]);
      }))]));
    }

    var marke = audit.betroffen > 0
      ? el('span', { 'class': 'nav__marke', title: tn('banner.sicherheit', audit.betroffen), text: String(audit.betroffen) })
      : el('span', { 'class': 'nav__ok' }, [zeichen('haken')]);
    var werkzeug = [
      eintrag({ text: t('nav.sicherheit'), symbol: 'schild', schluessel: 'sicherheit', aktiv: A === 'sicherheit', marke: marke, klick: function () { geheZu('sicherheit'); } }),
      eintrag({ text: t('nav.generator'), symbol: 'wuerfel', klick: function () { navZu(); generatorZeigen(); } }),
      eintrag({ text: t('nav.import'), symbol: 'import', klick: function () { navZu(); importZeigen(); } })
    ];
    if (muell > 0) {
      werkzeug.push(eintrag({ text: t('nav.papierkorb'), symbol: 'muell', schluessel: 'papierkorb', anzahl: muell, aktiv: A === 'papierkorb', klick: function () { geheZu('papierkorb'); } }));
    }
    nav.appendChild(gruppe(t('nav.werkzeug'), werkzeug));
  }

  /* ------------------------------------------------- Hinweisbanner */

  function bannerZeichnen() {
    var h = $('banner-halter');
    leeren(h);
    if (Z.ansicht !== 'start' || Z.suche) { return; }
    var b = V.backupFaellig(Z.daten);
    if (b.faellig && !Z.bannerWeg.sicherung) {
      h.appendChild(el('div', { 'class': 'banner', role: 'status' }, [
        el('span', { 'class': 'banner__symbol' }, [zeichen('sicherung')]),
        el('div', { 'class': 'banner__text' }, [
          el('strong', { text: b.nie ? t('banner.sicherungNie') : t('banner.sicherung', { tage: b.tage }) }),
          el('span', { text: ' ' + t('banner.sicherungText') })
        ]),
        el('div', { 'class': 'banner__tun' }, [
          el('button', { 'class': 'knopf knopf--klein knopf--haupt', text: t('banner.sicherungKnopf'), onclick: sicherungHerunterladen }),
          el('button', { 'class': 'knopf knopf--klein knopf--leise', text: t('banner.spaeter'), onclick: function () { Z.bannerWeg.sicherung = true; bannerZeichnen(); } })
        ])
      ]));
    }
  }

  /* ------------------------------------------------- Inhalt */

  var SORT_FOLGE = ['name', 'benutzt', 'neu', 'eigen'];
  var SORT_TEXT = { name: 'kopf.sortName', benutzt: 'kopf.sortBenutzt', neu: 'kopf.sortNeu', eigen: 'kopf.sortEigen' };

  function aktuelleListe() {
    var d = Z.daten, q = Z.suche, s = Z.sortierung;
    if (q && (Z.ansicht === 'start' || Z.ansicht === 'sicherheit')) { return V.search(d, q, null, false, s); }
    switch (Z.ansicht) {
      case 'fav': return V.search(d, q, null, true, s);
      case 'kat': return V.search(d, q, Z.kategorie, false, s);
      case 'ohne': return V.search(d, q, null, false, s).filter(function (it) { return !it.cat; });
      case 'tag': return V.search(d, q, null, false, s, Z.tag);
      case 'zuletzt':
        var treffer = Object.create(null);
        V.search(d, q, null, false, s).forEach(function (it) { treffer[it.id] = true; });
        return V.recentlyUsed(d, 60).filter(function (it) { return treffer[it.id]; });
      default: return V.search(d, q, null, false, s);
    }
  }

  function ansichtTitel() {
    if (Z.suche) { return t('kopf.suche', { q: Z.suche }); }
    switch (Z.ansicht) {
      case 'fav': return t('nav.favoriten');
      case 'zuletzt': return t('nav.zuletzt');
      case 'ohne': return t('nav.ohneReiter');
      case 'tag': return '#' + Z.tag;
      case 'papierkorb': return t('nav.papierkorb');
      case 'sicherheit': return t('sich.titel');
      case 'start': return t('start2.hallo');
      case 'kat':
        var c = Z.daten.categories.filter(function (x) { return x.id === Z.kategorie; })[0];
        return c ? (c.name || t('allg.ohneName')) : t('nav.alle');
      default: return t('nav.alle');
    }
  }

  function inhaltZeichnen() {
    var inh = $('inhalt');
    leeren(inh);
    var q = Z.suche;
    if (!q && Z.ansicht === 'start') { startZeichnen(inh); return; }
    if (!q && Z.ansicht === 'sicherheit') { sicherheitZeichnen(inh); return; }
    if (Z.ansicht === 'papierkorb') { papierkorbZeichnen(inh); return; }
    listeZeichnen(inh);
  }

  function kopfBauen(titel, anzahl, mitSteuerung) {
    var kinder = [el('div', { 'class': 'kopf__titel' }, [
      el('h1', { 'class': 'kopf__h', id: 'ansicht-titel', text: titel }),
      anzahl !== null ? el('span', { 'class': 'kopf__anzahl', text: tn('kopf.anzahl', anzahl) }) : null
    ])];
    if (mitSteuerung) {
      var darst = el('div', { 'class': 'umschalter', role: 'group', 'aria-label': t('kopf.kacheln') + ' / ' + t('kopf.liste') }, ['kacheln', 'liste'].map(function (d) {
        var an = Z.darstellung === d;
        return el('button', {
          'class': 'umschalter__knopf' + (an ? ' umschalter__knopf--an' : ''), 'aria-pressed': an ? 'true' : 'false',
          title: t('kopf.' + d), 'aria-label': t('kopf.' + d), 'data-darstellung': d,
          onclick: function () { Z.darstellung = d; inhaltZeichnen(); }
        }, [zeichen(d)]);
      }));
      var sort = el('button', {
        'class': 'knopf knopf--klein', id: 'b-sortieren', title: t('kopf.sortierung', { name: t(SORT_TEXT[Z.sortierung]) }),
        onclick: sortierUmschalten
      }, [zeichen('sortieren'), el('span', { text: t(SORT_TEXT[Z.sortierung]) })]);
      var wahl = el('button', {
        'class': 'knopf knopf--klein' + (Z.auswahl ? ' knopf--an' : ''), id: 'b-auswahl', 'aria-pressed': Z.auswahl ? 'true' : 'false',
        onclick: function () { auswahlUmschalten(); }
      }, [zeichen('wahl'), el('span', { text: t('kopf.auswaehlen') })]);
      kinder.push(el('div', { 'class': 'kopf__tun' }, [sort, darst, wahl]));
    }
    return el('div', { 'class': 'kopf' }, kinder);
  }

  function leerBauen(titel, text, knoepfe) {
    return el('div', { 'class': 'leer' }, [
      el('div', { 'class': 'leer__bild' }, [zeichen('lesezeichen')]),
      el('strong', { 'class': 'leer__titel', text: titel }),
      el('p', { 'class': 'leer__text', text: text }),
      knoepfe ? el('div', { 'class': 'leer__tun' }, knoepfe) : null
    ]);
  }

  function listeZeichnen(inh) {
    var liste = aktuelleListe();
    inh.appendChild(kopfBauen(ansichtTitel(), liste.length, true));
    if (Z.sortierung === 'eigen' && liste.length > 1) {
      inh.appendChild(el('p', { 'class': 'kopf__hinweis', text: t('kopf.eigenHinweis') }));
    }
    if (liste.length === 0) {
      if (Z.suche || Z.ansicht === 'tag') { inh.appendChild(leerBauen(t('leer.nichts'), t('leer.nichtsText'))); }
      else if (Z.ansicht === 'zuletzt') { inh.appendChild(leerBauen(t('leer.zuletzt'), t('leer.zuletztText'))); }
      else if (Z.ansicht === 'kat' || Z.ansicht === 'fav') { inh.appendChild(leerBauen(Z.ansicht === 'fav' ? t('start2.favoriten') : t('leer.reiter'), Z.ansicht === 'fav' ? t('start2.favLeer') : t('leer.reiterText'))); }
      else { inh.appendChild(leerBauen(t('start2.leerTitel'), t('start2.leerText'), [el('button', { 'class': 'knopf', text: t('start2.leerImport'), onclick: importZeigen })])); }
      return;
    }
    var gitter = el('div', { 'class': 'gitter gitter--' + Z.darstellung, id: 'gitter' });
    liste.forEach(function (it, i) { gitter.appendChild(karteBauen(it, { liste: liste, index: i })); });
    inh.appendChild(gitter);
  }

  /* ------------------------------------------------- Übersicht */

  function startZeichnen(inh) {
    var d = Z.daten;
    var lebend = d.items.filter(function (it) { return !it.deletedAt; });
    inh.appendChild(kopfBauen(t('start2.hallo'), null, false));

    if (lebend.length === 0) {
      inh.appendChild(leerBauen(t('start2.leerTitel'), t('start2.leerText'), [
        el('button', { 'class': 'knopf knopf--haupt', onclick: function () { blattBearbeiten(null); } }, [zeichen('plus'), t('leiste.neueKarte')]),
        el('button', { 'class': 'knopf', onclick: importZeigen }, [zeichen('import'), t('start2.leerImport')])
      ]));
      return;
    }

    /* Kennzahlen */
    var audit = V.audit(d);
    var mitPass = lebend.filter(function (it) { return it.pass; }).length;
    var noteFarbe = audit.note >= 90 ? 'gruen' : (audit.note >= 60 ? 'gelb' : 'rot');
    inh.appendChild(el('div', { 'class': 'zahlen' }, [
      zahlKachel(lebend.length, t('start2.statKarten'), function () { geheZu('alle'); }),
      zahlKachel(mitPass, t('start2.statZugaenge'), function () { geheZu('alle'); }),
      zahlKachel(lebend.length - mitPass, t('start2.statLesezeichen'), function () { geheZu('alle'); }),
      zahlKachel(audit.note + '%', t('start2.statSicherheit'), function () { geheZu('sicherheit'); }, noteFarbe)
    ]));

    if (audit.aufgaben > 0) {
      inh.appendChild(el('div', { 'class': 'banner banner--leise' }, [
        el('span', { 'class': 'banner__symbol' }, [zeichen('schild')]),
        el('div', { 'class': 'banner__text' }, [el('strong', { text: tn('banner.sicherheit', audit.betroffen) })]),
        el('div', { 'class': 'banner__tun' }, [el('button', { 'class': 'knopf knopf--klein', text: t('banner.ansehen'), onclick: function () { geheZu('sicherheit'); } })])
      ]));
    }

    /* Favoriten als große Kacheln, wie eine Startseite. */
    var favs = V.search(d, '', null, true, Z.sortierung === 'benutzt' ? 'benutzt' : 'eigen');
    inh.appendChild(abschnittKopf(t('start2.favoriten'), favs.length ? function () { geheZu('fav'); } : null));
    if (favs.length) {
      var g = el('div', { 'class': 'gitter gitter--gross' });
      favs.forEach(function (it, i) { g.appendChild(karteBauen(it, { gross: true, liste: favs, index: i })); });
      inh.appendChild(g);
    } else {
      inh.appendChild(el('p', { 'class': 'abschnitt__leer', text: t('start2.favLeer') }));
    }

    var zuletzt = V.recentlyUsed(d, 8);
    if (zuletzt.length) {
      inh.appendChild(abschnittKopf(t('start2.zuletzt'), function () { geheZu('zuletzt'); }));
      inh.appendChild(el('div', { 'class': 'streifen' }, zuletzt.map(function (it) {
        return el('button', { 'class': 'streifen__eintrag', onclick: function () { blattZeigen(it); } }, [
          symbolBauen(it, 'streifen__symbol'),
          el('span', { 'class': 'streifen__titel', text: titelVon(it) })
        ]);
      })));
    }

    if (d.categories.length) {
      inh.appendChild(abschnittKopf(t('start2.reiter'), null));
      var zaehler = Object.create(null);
      lebend.forEach(function (it) { if (it.cat) { zaehler[it.cat] = (zaehler[it.cat] || 0) + 1; } });
      inh.appendChild(el('div', { 'class': 'reiterkacheln' }, d.categories.slice().sort(function (a, b) { return a.order - b.order; }).map(function (c) {
        return el('button', { 'class': 'reiterkachel', stil: '--f:var(--kat-' + c.color + ')', onclick: function () { geheZu('kat', c.id); } }, [
          el('span', { 'class': 'reiterkachel__punkt' }),
          el('span', { 'class': 'reiterkachel__name', text: c.name || t('allg.ohneName') }),
          el('span', { 'class': 'reiterkachel__zahl', text: tn('kopf.anzahl', zaehler[c.id] || 0) })
        ]);
      })));
    }
  }

  function zahlKachel(wert, text, klick, farbe) {
    return el('button', { 'class': 'zahl' + (farbe ? ' zahl--' + farbe : ''), onclick: klick }, [
      el('span', { 'class': 'zahl__wert', text: String(wert) }),
      el('span', { 'class': 'zahl__text', text: text })
    ]);
  }

  function abschnittKopf(titel, alle) {
    return el('div', { 'class': 'abschnitt' }, [
      el('h2', { 'class': 'abschnitt__titel', text: titel }),
      alle ? el('button', { 'class': 'knopf knopf--leise knopf--klein', onclick: alle }, [t('start2.alleZeigen'), zeichen('rechts')]) : null
    ]);
  }

  /* ------------------------------------------------- Eine Karte */

  function istAlt(it) {
    var m = Z.daten.settings.maxAgeMonths;
    if (!m || !it.pass) { return false; }
    var tage = V.passwordAgeDays(it);
    return tage !== null && tage >= m * 30.44;
  }

  function karteBauen(it, opt) {
    opt = opt || {};
    var host = V.hostOf(it.url);
    var href = V.safeUrl(it.url);
    var cat = katVon(it);
    var gross = !!opt.gross;
    var zeile = !gross && Z.darstellung === 'liste';
    var wahlModus = !!Z.auswahl && !gross;
    var gewaehlt = wahlModus && !!Z.auswahl[it.id];
    var name = titelVon(it);

    var tun = el('div', { 'class': 'karte__tun' });
    if (href) {
      tun.appendChild(el('button', {
        'class': 'tun', title: t('karte.oeffnen'), 'aria-label': t('karte.oeffnenAria', { name: name }), 'data-tun': 'oeffnen',
        onclick: function (e) { e.stopPropagation(); benutzt(it); oeffneSeite(href); }
      }, [zeichen('extern')]));
    }
    if (it.user) {
      tun.appendChild(el('button', {
        'class': 'tun', title: t('karte.benutzerKopieren'), 'aria-label': t('karte.benutzerKopieren') + ': ' + name, 'data-tun': 'benutzer',
        onclick: function (e) { e.stopPropagation(); benutzt(it); kopiere(it.user, t('was.benutzer')); }
      }, [zeichen('person')]));
    }
    if (it.pass) {
      tun.appendChild(el('button', {
        'class': 'tun', title: t('karte.passwortKopieren'), 'aria-label': t('karte.passwortKopieren') + ': ' + name, 'data-tun': 'passwort',
        onclick: function (e) { e.stopPropagation(); benutzt(it); kopiere(it.pass, t('was.passwort')); }
      }, [zeichen('schluessel')]));
    }
    if (!gross) tun.appendChild(el('button', {
      'class': 'tun tun--stern' + (it.fav ? ' tun--an' : ''), title: it.fav ? t('karte.favAus') : t('karte.favAn'),
      'aria-label': it.fav ? t('karte.favAus') : t('karte.favAn'), 'aria-pressed': it.fav ? 'true' : 'false', 'data-tun': 'stern',
      onclick: function (e) {
        e.stopPropagation();
        it.fav = !it.fav; it.updatedAt = jetzt();
        schmutzig(true); zeichnen();
      }
    }, [zeichen('stern', it.fav)]));

    var unten = [];
    if (host) { unten.push(host); }
    if (it.user && !gross) { unten.push(it.user); }
    var untenText = unten.join(' · ') || (V.isBookmark(it) ? t('karte.lesezeichen') : '');

    var marken = el('div', { 'class': 'karte__marken' });
    if (cat && !gross && Z.ansicht !== 'kat') {
      marken.appendChild(el('span', { 'class': 'marke-reiter', stil: '--f:var(--kat-' + cat.color + ')', text: cat.name || t('allg.ohneName') }));
    }
    if (!gross) {
      (it.tags || []).slice(0, zeile ? 4 : 2).forEach(function (tg) { marken.appendChild(el('span', { 'class': 'marke-tag', text: '#' + tg })); });
    }
    if (istAlt(it)) {
      marken.appendChild(el('span', { 'class': 'marke-alt', title: t('karte.alt', { n: Z.daten.settings.maxAgeMonths }) }, [zeichen('uhr')]));
    }

    var klasse = 'karte ' + (gross ? 'karte--gross' : (zeile ? 'karte--zeile' : 'karte--kachel')) +
      (gewaehlt ? ' karte--gewaehlt' : '') + (wahlModus ? ' karte--wahlmodus' : '');
    var farbe = it.color || (cat ? cat.color : '');

    var kinder = [];
    if (wahlModus) {
      kinder.push(el('span', { 'class': 'karte__wahl' + (gewaehlt ? ' karte__wahl--an' : ''), 'aria-hidden': 'true' }, [zeichen('haken')]));
    }
    kinder.push(symbolBauen(it, 'karte__symbol'));
    kinder.push(el('div', { 'class': 'karte__text' }, [
      el('h3', { 'class': 'karte__titel', text: name }),
      el('p', { 'class': 'karte__unten', text: untenText })
    ]));
    if (marken.firstChild) { kinder.push(marken); }
    if (!wahlModus) { kinder.push(tun); }

    /* Eigene Reihenfolge: Pfeile (für Tastatur und Touch) und Ziehen (Maus). */
    var ordnen = Z.sortierung === 'eigen' && opt.liste && opt.liste.length > 1 && !wahlModus && !gross;
    if (ordnen) {
      kinder.push(el('div', { 'class': 'karte__ordnen' }, [
        el('button', {
          'class': 'tun tun--klein', title: t('karte.frueher'), 'aria-label': t('karte.frueher') + ': ' + name, disabled: opt.index === 0,
          onclick: function (e) { e.stopPropagation(); verschiebeKarte(opt.liste, opt.index, opt.index - 1); }
        }, [zeichen(zeile ? 'hoch' : 'links')]),
        el('span', { 'class': 'karte__griff', title: t('karte.ziehen'), 'aria-hidden': 'true' }, [zeichen('griff')]),
        el('button', {
          'class': 'tun tun--klein', title: t('karte.spaeter'), 'aria-label': t('karte.spaeter') + ': ' + name, disabled: opt.index === opt.liste.length - 1,
          onclick: function (e) { e.stopPropagation(); verschiebeKarte(opt.liste, opt.index, opt.index + 1); }
        }, [zeichen(zeile ? 'runter' : 'rechts')])
      ]));
    }

    var karte = el('div', {
      'class': klasse, role: 'button', tabindex: '0', 'data-id': it.id,
      'aria-label': wahlModus ? t('karte.auswahl', { name: name }) : name,
      'aria-pressed': wahlModus ? (gewaehlt ? 'true' : 'false') : null,
      stil: farbe ? '--f:var(--kat-' + farbe + ')' : '',
      onclick: function () { if (wahlModus) { auswahlKippen(it.id); } else { blattZeigen(it); } },
      onkeydown: function (e) {
        if (e.target !== karte) { return; }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (wahlModus) { auswahlKippen(it.id); } else { blattZeigen(it); } }
      }
    }, kinder);

    if (ordnen) {
      karte.setAttribute('draggable', 'true');
      karte.addEventListener('dragstart', function (e) {
        Z.ziehId = it.id;
        karte.classList.add('karte--zieht');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ''); } catch (x) { /* egal */ } }
      });
      karte.addEventListener('dragend', function () { Z.ziehId = null; karte.classList.remove('karte--zieht'); });
      karte.addEventListener('dragover', function (e) { if (Z.ziehId && Z.ziehId !== it.id) { e.preventDefault(); karte.classList.add('karte--ziel'); } });
      karte.addEventListener('dragleave', function () { karte.classList.remove('karte--ziel'); });
      karte.addEventListener('drop', function (e) {
        e.preventDefault();
        karte.classList.remove('karte--ziel');
        var von = -1;
        opt.liste.forEach(function (x, i) { if (x.id === Z.ziehId) { von = i; } });
        Z.ziehId = null;
        if (von >= 0) { verschiebeKarte(opt.liste, von, opt.index); }
      });
    }
    return karte;
  }

  function verschiebeKarte(liste, von, nach) {
    var id = liste[von] && liste[von].id;
    if (!V.moveInList(liste, von, nach)) { return false; }
    schmutzig(true);
    inhaltZeichnen();
    /* Fokus auf der verschobenen Karte halten, sonst springt er beim
     * Verschieben mit der Tastatur an den Anfang. */
    var k = document.querySelector('.karte[data-id="' + id + '"]');
    if (k) { k.focus(); }
    return true;
  }

  /* Merkt sich, wann eine Karte zuletzt benutzt wurde, für die Sortierung und
   * „Zuletzt geöffnet“. Das gilt nicht als inhaltliche Änderung, es löst also
   * kein „ungespeichert“ aus; gespeichert wird es mit der nächsten Änderung. */
  function benutzt(it) {
    it.usedAt = jetzt();
  }

  function oeffneSeite(href) {
    var sicher = V.safeUrl(href);
    if (!sicher) { return; }
    var w = window.open(sicher, '_blank', 'noopener,noreferrer');
    if (w) { w.opener = null; }
    else { zuruf(t('sp.fensterBlockiert'), true); }
  }

  /* ------------------------------------------------- Auswahl mehrerer Karten */

  function auswahlUmschalten(an) {
    var soll = an === undefined ? !Z.auswahl : an;
    Z.auswahl = soll ? {} : null;
    inhaltZeichnen();
    auswahlLeisteZeichnen();
  }

  function auswahlKippen(id) {
    if (!Z.auswahl) { return; }
    if (Z.auswahl[id]) { delete Z.auswahl[id]; } else { Z.auswahl[id] = true; }
    var k = document.querySelector('.karte[data-id="' + id + '"]');
    if (k) {
      var an = !!Z.auswahl[id];
      k.classList.toggle('karte--gewaehlt', an);
      k.setAttribute('aria-pressed', an ? 'true' : 'false');
      var w = k.querySelector('.karte__wahl');
      if (w) { w.classList.toggle('karte__wahl--an', an); }
    }
    auswahlLeisteZeichnen();
  }

  function gewaehlteKarten() {
    if (!Z.auswahl) { return []; }
    return Z.daten.items.filter(function (it) { return Z.auswahl[it.id] && !it.deletedAt; });
  }

  function auswahlLeisteZeichnen() {
    var leiste = $('auswahl-leiste');
    var plus = $('b-neu-eintrag');
    leeren(leiste);
    if (!Z.auswahl || !Z.daten) {
      leiste.classList.add('versteckt');
      plus.classList.remove('versteckt');
      return;
    }
    leiste.classList.remove('versteckt');
    plus.classList.add('versteckt');
    var karten = gewaehlteKarten();
    var n = karten.length;

    function nurMit(f) { return function () { if (!n) { zuruf(t('auswahl.keine'), true); return; } f(); }; }

    var reiterWahl = el('select', { 'class': 'eingabe eingabe--klein', 'aria-label': t('auswahl.reiter') });
    reiterWahl.appendChild(el('option', { value: '__nichts', text: t('auswahl.reiter') }));
    reiterWahl.appendChild(el('option', { value: '', text: t('edit.ohneReiter') }));
    Z.daten.categories.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (c) {
      reiterWahl.appendChild(el('option', { value: c.id, text: c.name || t('allg.ohneName') }));
    });
    reiterWahl.addEventListener('change', function () {
      var v = reiterWahl.value;
      if (v === '__nichts') { return; }
      if (!n) { zuruf(t('auswahl.keine'), true); reiterWahl.value = '__nichts'; return; }
      karten.forEach(function (it) { it.cat = v || null; it.updatedAt = jetzt(); });
      schmutzig(true);
      zuruf(t('auswahl.verschoben', { n: n }));
      zeichnen();
    });

    leiste.appendChild(el('span', { 'class': 'auswahl-leiste__zahl', text: tn('auswahl.anzahl', n) }));
    leiste.appendChild(el('button', {
      'class': 'knopf knopf--klein knopf--leise', text: t('auswahl.alle'),
      onclick: function () { aktuelleListe().forEach(function (it) { Z.auswahl[it.id] = true; }); inhaltZeichnen(); auswahlLeisteZeichnen(); }
    }));
    leiste.appendChild(el('span', { 'class': 'auswahl-leiste__luft' }));
    leiste.appendChild(reiterWahl);
    leiste.appendChild(el('button', {
      'class': 'knopf knopf--klein', onclick: nurMit(function () {
        tagFragen(n, function (tag) {
          karten.forEach(function (it) { it.tags = V.parseTags((it.tags || []).concat([tag]).join(',')); it.updatedAt = jetzt(); });
          schmutzig(true); zeichnen();
          zuruf(t('auswahl.getaggt', { tag: V.normTag(tag), n: n }));
        });
      })
    }, [zeichen('tag'), t('auswahl.schlagwort')]));
    leiste.appendChild(el('button', {
      'class': 'knopf knopf--klein', onclick: nurMit(function () {
        karten.forEach(function (it) { it.fav = true; it.updatedAt = jetzt(); });
        schmutzig(true); zeichnen(); zuruf(t('auswahl.favorisiert', { n: n }));
      })
    }, [zeichen('stern'), t('auswahl.favorit')]));
    leiste.appendChild(el('button', {
      'class': 'knopf knopf--klein knopf--gefahr', onclick: nurMit(function () {
        var zeit = jetzt();
        karten.forEach(function (it) { it.deletedAt = zeit; it.fav = false; it.updatedAt = zeit; });
        Z.auswahl = {};
        schmutzig(true); zeichnen();
        zurufMitZurueck(t('muell.gelegt.n', { n: n }), function () {
          karten.forEach(function (it) { it.deletedAt = null; it.updatedAt = jetzt(); });
          schmutzig(true); zeichnen(); zuruf(t('muell.zurueckgeholt'));
        });
      })
    }, [zeichen('muell'), t('allg.loeschen')]));
    leiste.appendChild(el('button', { 'class': 'knopf knopf--klein knopf--haupt', text: t('allg.fertig'), onclick: function () { auswahlUmschalten(false); } }));
  }

  function tagFragen(n, fertig) {
    var eingabe = el('input', { 'class': 'eingabe', type: 'text', maxlength: '40', list: 'tag-vorschlaege' });
    var liste = el('datalist', { id: 'tag-vorschlaege' }, V.allTags(Z.daten).map(function (x) { return el('option', { value: x.tag }); }));
    function los() {
      var tag = V.normTag(eingabe.value);
      if (!tag) { return; }
      vorhangZu();
      fertig(tag);
    }
    eingabe.addEventListener('keydown', function (e) { if (e.key === 'Enter') { los(); } });
    var blatt = blattBauen({
      titel: t('auswahl.schlagwort'), schmal: true,
      leib: [feld(t('auswahl.schlagwortFrage', { n: n }), eingabe), liste],
      fuss: [
        el('button', { 'class': 'knopf', text: t('allg.abbrechen'), onclick: vorhangZu }),
        el('button', { 'class': 'knopf knopf--haupt', text: t('allg.hinzufuegen'), onclick: los })
      ]
    });
    vorhangAuf(blatt);
    setTimeout(function () { eingabe.focus(); }, 30);
  }

  /* ------------------------------------------------- Papierkorb */

  function papierkorbZeichnen(inh) {
    var q = Z.suche.toLowerCase();
    var liste = V.trashList(Z.daten).filter(function (it) {
      if (!q) { return true; }
      return (it.title + ' ' + it.url + ' ' + it.user).toLowerCase().indexOf(q) >= 0;
    });

    var kopf = kopfBauen(t('nav.papierkorb'), null, false);
    kopf.appendChild(el('div', { 'class': 'kopf__tun' }, [
      el('span', { 'class': 'kopf__anzahl', text: tn('muell.anzahl', liste.length) }),
      liste.length > 0 ? el('button', { 'class': 'knopf knopf--klein knopf--gefahr', text: t('muell.leeren'), onclick: papierkorbLeerenFragen }) : null
    ]));
    inh.appendChild(kopf);

    if (liste.length === 0) {
      inh.appendChild(leerBauen(t('muell.leer'), t('muell.leerText')));
      return;
    }

    var gitter = el('div', { 'class': 'gitter gitter--liste', id: 'gitter' });
    liste.forEach(function (it) {
      gitter.appendChild(el('div', { 'class': 'karte karte--zeile karte--muell' }, [
        symbolBauen(it, 'karte__symbol'),
        el('div', { 'class': 'karte__text' }, [
          el('h3', { 'class': 'karte__titel', text: titelVon(it) }),
          el('p', { 'class': 'karte__unten', text: t('muell.geloescht', { datum: I18N.datum(it.deletedAt) }) })
        ]),
        el('div', { 'class': 'karte__tun karte__tun--immer' }, [
          el('button', {
            'class': 'tun', title: t('muell.zurueckholen'), 'aria-label': t('muell.zurueckholen') + ': ' + titelVon(it), 'data-tun': 'zurueck',
            onclick: function () { it.deletedAt = null; it.updatedAt = jetzt(); schmutzig(true); zeichnen(); zuruf(t('muell.zurueckgeholt')); }
          }, [zeichen('zurueck')]),
          el('button', {
            'class': 'tun tun--gefahr', title: t('muell.endgueltig'), 'aria-label': t('muell.endgueltig') + ': ' + titelVon(it), 'data-tun': 'weg',
            onclick: function () {
              Z.daten.items = Z.daten.items.filter(function (x) { return x.id !== it.id; });
              schmutzig(true); zeichnen(); zuruf(t('muell.endgueltigGeloescht'));
            }
          }, [zeichen('muell')])
        ])
      ]));
    });
    inh.appendChild(gitter);
  }

  function papierkorbLeerenFragen() {
    var anzahl = V.trashList(Z.daten).length;
    var blatt = blattBauen({
      titel: t('muell.leerenFrage'), rolle: 'alertdialog', schmal: true,
      leib: [el('p', { 'class': 'absatz', text: tn('muell.leerenText', anzahl) })],
      fuss: [
        el('button', { 'class': 'knopf', text: t('muell.behalten'), onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--gefahr-voll', text: t('muell.leeren'),
          onclick: function () {
            Z.daten.items = Z.daten.items.filter(function (it) { return !it.deletedAt; });
            schmutzig(true); vorhangZu();
            if (Z.ansicht === 'papierkorb') { Z.ansicht = 'start'; }
            zeichnen(); zuruf(t('muell.geleert'));
          }
        })
      ]
    });
    vorhangAuf(blatt, false);
  }

  /* ------------------------------------------------- Dialoge (Vorhang + Blatt) */

  /* Baut ein Blatt einheitlich: Kopf mit Titel (und optional Symbol), Leib,
   * Fuß mit Knöpfen. */
  var _blattNr = 0;
  function blattBauen(o) {
    var titelId = 'blatt-titel-' + (++_blattNr);
    var kopf = el('div', { 'class': 'blatt__kopf' }, [
      o.symbol || null,
      el('div', { 'class': 'blatt__kopftext' }, [
        el('h2', { 'class': 'blatt__titel', id: titelId, text: o.titel }),
        o.unter ? el('p', { 'class': 'blatt__unter', text: o.unter }) : null
      ]),
      o.kopfTun || null,
      o.ohneZu ? null : el('button', { 'class': 'symbolknopf blatt__zu', 'aria-label': t('allg.schliessen'), title: t('allg.schliessen'), onclick: function () { (o.zu || vorhangZu)(); } }, [zeichen('kreuz')])
    ]);
    return el('div', {
      'class': 'blatt' + (o.schmal ? ' blatt--schmal' : '') + (o.breit ? ' blatt--breit' : '') + (o.klasse ? ' ' + o.klasse : ''),
      role: o.rolle || 'dialog', 'aria-modal': 'true', 'aria-labelledby': titelId
    }, [
      kopf,
      el('div', { 'class': 'blatt__leib' }, o.leib || []),
      o.fuss ? el('div', { 'class': 'blatt__fuss' }, o.fuss) : null
    ]);
  }

  var _fokusVorher = null;
  function vorhangAuf(blatt, mitKlickZu) {
    var halter = $('vorhang-halter');
    var warOffen = !!halter.firstChild;
    leeren(halter);
    if (!warOffen) { _fokusVorher = document.activeElement; }
    var vorhang = el('div', {
      'class': 'vorhang',
      onclick: function (e) { if (mitKlickZu !== false && e.target === vorhang) { vorhangZu(); } }
    }, [blatt]);
    halter.appendChild(vorhang);
    document.body.classList.add('vorhang-offen');
    fokusFalle(vorhang, blatt);
  }

  /* Tab bleibt innerhalb des Dialogs gefangen. Sonst wandert der Fokus hinter
   * den Vorhang auf die Kartei, die dort verdeckt liegt. */
  function fokusFalle(vorhang, blatt) {
    vorhang.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') { return; }
      var fokusbar = blatt.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])');
      fokusbar = Array.prototype.filter.call(fokusbar, function (n) { return !n.disabled && n.offsetParent !== null; });
      if (fokusbar.length === 0) { return; }
      var erst = fokusbar[0], letzt = fokusbar[fokusbar.length - 1];
      if (e.shiftKey && document.activeElement === erst) { e.preventDefault(); letzt.focus(); }
      else if (!e.shiftKey && document.activeElement === letzt) { e.preventDefault(); erst.focus(); }
    });
    if (!blatt.contains(document.activeElement)) {
      var erstes = blatt.querySelector('.blatt__zu') || blatt.querySelector('button');
      if (erstes) { try { erstes.focus({ preventScroll: true }); } catch (x) { /* egal */ } }
    }
  }

  function vorhangZu() {
    leeren($('vorhang-halter'));
    document.body.classList.remove('vorhang-offen');
    clearInterval(Z.countdownUhr);
    if (_fokusVorher && _fokusVorher.focus && document.body.contains(_fokusVorher)) { try { _fokusVorher.focus(); } catch (e) { /* egal */ } }
    _fokusVorher = null;
  }

  /* Ein Wert mit Knöpfen zum Kopieren (und optional Zeigen). */
  function wertZeile(o) {
    var verdeckt = !!o.verdeckt;
    var text = el('span', { 'class': 'wert__text' + (verdeckt ? ' wert__text--punkte' : '') + (o.mono ? ' mono' : ''), text: verdeckt ? '••••••••••••' : o.wert });
    var kn = [];
    if (verdeckt) {
      var sichtbar = false;
      var auge = el('button', { 'class': 'tun', title: t('allg.zeigen'), 'aria-label': t('allg.zeigen') + ': ' + o.name, 'data-tun': 'zeigen' }, [zeichen('auge')]);
      auge.addEventListener('click', function () {
        sichtbar = !sichtbar;
        text.textContent = sichtbar ? o.wert : '••••••••••••';
        text.classList.toggle('wert__text--punkte', !sichtbar);
        auge.setAttribute('title', sichtbar ? t('allg.verbergen') : t('allg.zeigen'));
        auge.setAttribute('aria-label', (sichtbar ? t('allg.verbergen') : t('allg.zeigen')) + ': ' + o.name);
        auge.replaceChildren(zeichen(sichtbar ? 'augeZu' : 'auge'));
      });
      kn.push(auge);
    }
    if (o.oeffnen) {
      kn.push(el('button', { 'class': 'tun', title: t('karte.oeffnen'), 'aria-label': t('karte.oeffnen'), 'data-tun': 'oeffnen', onclick: o.oeffnen }, [zeichen('extern')]));
    }
    kn.push(el('button', {
      'class': 'tun', title: t('allg.kopieren'), 'aria-label': t('allg.kopieren') + ': ' + o.name, 'data-tun': 'kopieren',
      onclick: function () { if (o.beimKopieren) { o.beimKopieren(); } kopiere(o.wert, o.name); }
    }, [zeichen('kopieren')]));
    return el('div', { 'class': 'wert' }, [text].concat(kn));
  }

  function abschnittBlatt(titel, kinder, zusatz) {
    return el('div', { 'class': 'blatt__abschnitt' }, [
      el('div', { 'class': 'blatt__abschnittkopf' }, [el('h3', { 'class': 'blatt__h', text: titel }), zusatz || null])
    ].concat(kinder));
  }

  /* ------------------------------------------------- Blatt: Karte ansehen */

  function blattZeigen(it) {
    var host = V.hostOf(it.url);
    var href = V.safeUrl(it.url);
    var leib = [];

    /* Adressen */
    var adressen = [];
    if (it.url) {
      adressen.push(wertZeile({ name: t('was.adresse'), wert: it.url, oeffnen: href ? function () { benutzt(it); oeffneSeite(href); } : null }));
      if (!href) { adressen.push(el('p', { 'class': 'feld__fehler', text: t('blatt.adresseUngueltig') })); }
      else if (href.indexOf('http:') === 0 && it.pass) { adressen.push(el('p', { 'class': 'feld__warn', text: t('blatt.ohneTls') })); }
    }
    (it.urls || []).forEach(function (u) {
      var h = V.safeUrl(u.url);
      adressen.push(el('div', { 'class': 'wert-mit-label' }, [
        u.label ? el('span', { 'class': 'wert-label', text: u.label }) : null,
        wertZeile({ name: u.label || t('was.adresse'), wert: u.url, oeffnen: h ? function () { benutzt(it); oeffneSeite(h); } : null })
      ]));
    });
    if (adressen.length) { leib.push(abschnittBlatt((it.urls || []).length ? t('blatt.adressen') : t('blatt.adresse'), adressen)); }

    if (it.user) {
      leib.push(abschnittBlatt(t('blatt.benutzer'), [wertZeile({ name: t('was.benutzer'), wert: it.user, mono: true, beimKopieren: function () { benutzt(it); } })]));
    }

    if (it.pass) {
      var r = V.ratePassword(it.pass);
      var tage = V.passwordAgeDays(it);
      var info = [el('span', { 'class': 'pille pille--' + (r.stufe >= 3 ? 'gruen' : (r.stufe >= 2 ? 'gelb' : 'rot')), text: t('blatt.passwortInfo', { stufe: t('staerke.' + r.stufe), bits: r.bits }) })];
      if (tage !== null) {
        info.push(el('span', { 'class': 'pille' + (istAlt(it) ? ' pille--gelb' : ''), text: t('blatt.geaendert', { wann: I18N.vorTagen(tage) }) }));
      }
      var andere = V.passwortAndernorts(Z.daten, it.pass, it.id);
      if (andere.length) {
        info.push(el('span', { 'class': 'pille pille--rot', title: andere.slice(0, 5).map(titelVon).join(', '), text: t('sich.doppelt') + ' · ' + t('sich.mal', { n: andere.length + 1 }) }));
      }
      leib.push(abschnittBlatt(t('blatt.passwort'), [
        wertZeile({ name: t('was.passwort'), wert: it.pass, verdeckt: true, mono: true, beimKopieren: function () { benutzt(it); } }),
        el('div', { 'class': 'pillen' }, info)
      ]));
    }

    if ((it.fields || []).length) {
      leib.push(abschnittBlatt(t('blatt.zusatz'), it.fields.map(function (f) {
        return el('div', { 'class': 'wert-mit-label' }, [
          el('span', { 'class': 'wert-label', text: f.label || '—' }),
          wertZeile({ name: f.label || t('blatt.zusatz'), wert: f.value, verdeckt: f.hidden, mono: f.hidden })
        ]);
      })));
    }

    if (it.note) {
      leib.push(abschnittBlatt(t('blatt.notiz'), [el('p', { 'class': 'notiz', text: it.note })]));
    }

    if ((it.tags || []).length) {
      leib.push(abschnittBlatt(t('blatt.schlagwoerter'), [el('div', { 'class': 'chips' }, it.tags.map(function (tg) {
        return el('button', { 'class': 'chip', onclick: function () { vorhangZu(); geheZu('tag', tg); } }, ['#' + tg]);
      }))]));
    }

    if ((it.history || []).length) {
      var verlauf = el('details', { 'class': 'verlauf' }, [
        el('summary', { 'class': 'verlauf__kopf' }, [zeichen('uhr'), tn('blatt.verlauf', it.history.length)])
      ]);
      it.history.forEach(function (h) {
        verlauf.appendChild(el('div', { 'class': 'wert-mit-label' }, [
          el('span', { 'class': 'wert-label', text: h.until ? t('blatt.verlaufBis', { datum: I18N.datum(h.until) }) : '—' }),
          wertZeile({ name: t('was.frueher'), wert: h.pass, verdeckt: true, mono: true })
        ]));
      });
      leib.push(verlauf);
    }

    if (V.isBookmark(it) && !(it.fields || []).length) {
      leib.push(el('p', { 'class': 'leise klein', text: t('blatt.nurLesezeichen') }));
    }

    leib.push(el('p', { 'class': 'blatt__meta', text: t('blatt.angelegt', { datum: I18N.datum(it.createdAt) }) + ' · ' + t('blatt.bearbeitet', { datum: I18N.datum(it.updatedAt) }) }));

    var stern = el('button', {
      'class': 'symbolknopf' + (it.fav ? ' symbolknopf--stern' : ''), title: it.fav ? t('karte.favAus') : t('karte.favAn'),
      'aria-label': it.fav ? t('karte.favAus') : t('karte.favAn'), 'aria-pressed': it.fav ? 'true' : 'false',
      onclick: function () {
        it.fav = !it.fav; it.updatedAt = jetzt(); schmutzig(true); zeichnen();
        stern.classList.toggle('symbolknopf--stern', it.fav);
        stern.setAttribute('aria-pressed', it.fav ? 'true' : 'false');
        stern.setAttribute('title', it.fav ? t('karte.favAus') : t('karte.favAn'));
        stern.replaceChildren(zeichen('stern', it.fav));
      }
    }, [zeichen('stern', it.fav)]);

    var cat = katVon(it);
    var blatt = blattBauen({
      titel: titelVon(it),
      unter: [host, cat ? cat.name : ''].filter(Boolean).join(' · '),
      symbol: symbolBauen(it, 'blatt__symbol'),
      kopfTun: stern,
      leib: leib,
      fuss: [
        el('button', { 'class': 'knopf knopf--gefahr', onclick: function () { loeschenFragen(it); } }, [zeichen('muell'), t('allg.loeschen')]),
        el('span', { 'class': 'blatt__luft' }),
        el('button', { 'class': 'knopf', onclick: function () { blattBearbeiten(it); } }, [zeichen('stift'), t('allg.bearbeiten')]),
        href ? el('button', { 'class': 'knopf knopf--haupt', id: 'b-blatt-oeffnen', onclick: function () { benutzt(it); oeffneSeite(href); } }, [zeichen('extern'), t('karte.oeffnen')]) : null
      ]
    });
    vorhangAuf(blatt);
  }

  /* ------------------------------------------------- Blatt: Karte bearbeiten */

  function blattBearbeiten(vorhanden) {
    var neu = !vorhanden;
    var it = vorhanden || V.newItem({ cat: Z.ansicht === 'kat' ? Z.kategorie : null, fav: Z.ansicht === 'fav', tags: Z.ansicht === 'tag' ? [Z.tag] : [] });

    var fTitel = el('input', { 'class': 'eingabe', type: 'text', value: it.title, maxlength: '120', id: 'e-titel' });
    var fUrl = el('input', { 'class': 'eingabe mono', type: 'text', value: it.url, placeholder: t('edit.adressePh'), maxlength: '2000', id: 'e-url', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false' });
    var fUser = el('input', { 'class': 'eingabe mono', type: 'text', value: it.user, autocomplete: 'off', maxlength: '200', id: 'e-user', autocapitalize: 'off', spellcheck: 'false' });
    var fPass = el('input', { 'class': 'eingabe mono', type: 'password', value: it.pass, autocomplete: 'new-password', maxlength: '256', id: 'e-pass', spellcheck: 'false', 'aria-label': t('edit.passwort') });
    var fNotiz = el('textarea', { 'class': 'eingabe', maxlength: '4000', id: 'e-notiz', rows: '3' });
    fNotiz.value = it.note;
    var fTags = el('input', { 'class': 'eingabe', type: 'text', value: (it.tags || []).join(', '), placeholder: t('edit.schlagwoerterPh'), maxlength: '400', id: 'e-tags' });
    var fEmoji = el('input', { 'class': 'eingabe eingabe--emoji', type: 'text', value: it.emoji || '', placeholder: t('edit.emojiPh'), maxlength: '16', id: 'e-emoji', 'aria-label': t('edit.emoji') });
    var fFav = el('input', { type: 'checkbox', id: 'e-fav' });
    fFav.checked = !!it.fav;

    var fKat = el('select', { 'class': 'eingabe', id: 'e-kat' });
    fKat.appendChild(el('option', { value: '', text: t('edit.ohneReiter') }));
    Z.daten.categories.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (c) {
      var o = el('option', { value: c.id, text: c.name || t('allg.ohneName') });
      if (it.cat === c.id) { o.selected = true; }
      fKat.appendChild(o);
    });

    /* Symbol: Vorschau, Emoji, Farbe */
    var farbeWahl = it.color || '';
    var vorschau = el('div', { 'class': 'edit-symbol__vorschau' });
    function vorschauZeigen() {
      var probe = { title: fTitel.value || it.title, url: fUrl.value, emoji: V.sanitizeEmoji(fEmoji.value), color: farbeWahl, cat: fKat.value || null };
      vorschau.replaceChildren(symbolBauen(probe, 'edit-symbol__bild'));
    }
    var farben = el('div', { 'class': 'farbwahl', role: 'radiogroup', 'aria-label': t('edit.farbe') });
    function farbenZeichnen() {
      leeren(farben);
      [''].concat(V.CATEGORY_COLORS).forEach(function (f) {
        var an = farbeWahl === f;
        farben.appendChild(el('button', {
          type: 'button', 'class': 'farbwahl__knopf' + (an ? ' farbwahl__knopf--an' : '') + (f ? '' : ' farbwahl__knopf--auto'),
          role: 'radio', 'aria-checked': an ? 'true' : 'false', title: f ? t('farbe.' + f) : t('edit.farbeAuto'), 'aria-label': f ? t('farbe.' + f) : t('edit.farbeAuto'),
          stil: f ? '--f:var(--kat-' + f + ')' : '',
          onclick: function () { farbeWahl = f; farbenZeichnen(); vorschauZeigen(); }
        }));
      });
    }
    farbenZeichnen();
    [fTitel, fUrl, fEmoji].forEach(function (f) { f.addEventListener('input', vorschauZeigen); });
    fKat.addEventListener('change', vorschauZeigen);
    vorschauZeigen();

    /* Weitere Adressen */
    var urlZeilen = el('div', { 'class': 'zeilen' });
    function urlZeileDazu(u) {
      var lab = el('input', { 'class': 'eingabe eingabe--klein', type: 'text', value: u.label || '', placeholder: t('edit.adresseLabelPh'), maxlength: '60' });
      var adr = el('input', { 'class': 'eingabe eingabe--klein mono', type: 'text', value: u.url || '', placeholder: 'https://…', maxlength: '2000', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false' });
      var zeile = el('div', { 'class': 'zeile zeile--url' }, [lab, adr]);
      zeile.appendChild(el('button', { 'class': 'tun', type: 'button', title: t('allg.entfernen'), 'aria-label': t('allg.entfernen'), onclick: function () { zeile.remove(); } }, [zeichen('kreuz')]));
      zeile._lesen = function () { return { label: lab.value, url: adr.value }; };
      urlZeilen.appendChild(zeile);
      return adr;
    }
    (it.urls || []).forEach(urlZeileDazu);

    /* Zusatzfelder */
    var feldZeilen = el('div', { 'class': 'zeilen' });
    function feldZeileDazu(f) {
      var verborgen = !!f.hidden;
      var lab = el('input', { 'class': 'eingabe eingabe--klein', type: 'text', value: f.label || '', placeholder: t('edit.feldLabelPh'), maxlength: '60' });
      var wert = el('input', { 'class': 'eingabe eingabe--klein' + (verborgen ? ' mono' : ''), type: verborgen ? 'password' : 'text', value: f.value || '', placeholder: t('edit.feldWertPh'), maxlength: '4000', autocomplete: 'off', spellcheck: 'false' });
      var schalter = el('button', { 'class': 'tun' + (verborgen ? ' tun--an' : ''), type: 'button' });
      function schalterZeigen() {
        schalter.replaceChildren(zeichen(verborgen ? 'augeZu' : 'auge'));
        schalter.setAttribute('title', verborgen ? t('edit.feldZeigen') : t('edit.feldVerbergen'));
        schalter.setAttribute('aria-label', verborgen ? t('edit.feldZeigen') : t('edit.feldVerbergen'));
        schalter.setAttribute('aria-pressed', verborgen ? 'true' : 'false');
        schalter.classList.toggle('tun--an', verborgen);
        wert.type = verborgen ? 'password' : 'text';
        wert.classList.toggle('mono', verborgen);
      }
      schalter.addEventListener('click', function () { verborgen = !verborgen; schalterZeigen(); });
      schalterZeigen();
      var zeile = el('div', { 'class': 'zeile zeile--feld' }, [lab, wert, schalter]);
      zeile.appendChild(el('button', { 'class': 'tun', type: 'button', title: t('allg.entfernen'), 'aria-label': t('allg.entfernen'), onclick: function () { zeile.remove(); } }, [zeichen('kreuz')]));
      zeile._lesen = function () { return { label: lab.value, value: wert.value, hidden: verborgen }; };
      feldZeilen.appendChild(zeile);
      return f.label ? wert : lab;
    }
    (it.fields || []).forEach(feldZeileDazu);

    function vorlage(label, verborgen) {
      return el('button', { 'class': 'chip chip--dazu', type: 'button', onclick: function () { feldZeileDazu({ label: label, hidden: verborgen }).focus(); } }, [zeichen('plus'), label]);
    }

    /* Schlagwörter: vorhandene zum Antippen */
    var vorhandeneTags = V.allTags(Z.daten);
    var tagVorschlaege = vorhandeneTags.length ? el('div', { 'class': 'chips chips--klein' }, [el('span', { 'class': 'leise klein', text: t('edit.schlagwoerterVorhanden') })].concat(vorhandeneTags.slice(0, 16).map(function (x) {
      return el('button', {
        'class': 'chip chip--klein', type: 'button', onclick: function () {
          var liste = V.parseTags(fTags.value);
          if (!liste.some(function (y) { return y.toLowerCase() === x.tag.toLowerCase(); })) { liste.push(x.tag); }
          fTags.value = liste.join(', ');
        }
      }, ['#' + x.tag]);
    }))) : null;

    /* Passwort: Stärke, Dubletten, Verlaufshinweis */
    var staerke = staerkeBauen();
    var dublette = el('p', { 'class': 'feld__warn versteckt', id: 'e-dublette' });
    var verlaufHinweis = el('p', { 'class': 'feld__info versteckt', text: t('edit.verlaufHinweis') });
    function passwortPruefen() {
      staerke.zeigen(fPass.value);
      /* Warnen, wenn dieses Passwort schon woanders im Tresor steht. */
      var andere = V.passwortAndernorts(Z.daten, fPass.value, it.id);
      if (andere.length > 0) {
        var namen = andere.slice(0, 3).map(titelVon).join(', ');
        dublette.textContent = t('edit.dublette', { namen: namen + (andere.length > 3 ? t('edit.dubletteMehr') : '') });
        dublette.classList.remove('versteckt');
      } else {
        dublette.classList.add('versteckt');
      }
      verlaufHinweis.classList.toggle('versteckt', !(it.pass && fPass.value !== it.pass));
    }
    fPass.addEventListener('input', passwortPruefen);

    var augeKnopf = el('button', { 'class': 'tun', type: 'button', title: t('edit.zeigen'), 'aria-label': t('edit.zeigen') }, [zeichen('auge')]);
    augeKnopf.addEventListener('click', function () {
      var zu = fPass.type === 'password';
      fPass.type = zu ? 'text' : 'password';
      augeKnopf.replaceChildren(zeichen(zu ? 'augeZu' : 'auge'));
    });
    function passwortSetzen(pw) { fPass.value = pw; fPass.type = 'text'; augeKnopf.replaceChildren(zeichen('augeZu')); passwortPruefen(); }

    var passGruppe = el('div', { 'class': 'eingabe-gruppe' }, [
      fPass, augeKnopf,
      el('button', { 'class': 'tun', type: 'button', title: t('edit.wuerfeln'), 'aria-label': t('edit.wuerfeln'), 'data-tun': 'wuerfeln', onclick: function () { passwortSetzen(V.generatePassword({ length: 20, zeichen: true })); } }, [zeichen('wuerfel')]),
      el('button', { 'class': 'tun', type: 'button', title: t('edit.merksatz'), 'aria-label': t('edit.merksatz'), 'data-tun': 'merksatz', onclick: function () { passwortSetzen(V.generatePassphrase({ words: 5 })); } }, [zeichen('feder')]),
      el('button', { 'class': 'tun', type: 'button', title: t('edit.generator'), 'aria-label': t('edit.generator'), 'data-tun': 'generator', onclick: function () { generatorZeigen(passwortSetzen, true); } }, [zeichen('regler')])
    ]);

    var weitereAdressen = el('div', { 'class': 'feld' }, [
      el('span', { 'class': 'feld__name', text: t('edit.weitereAdressen') }),
      urlZeilen,
      el('button', { 'class': 'knopf knopf--leise knopf--klein', type: 'button', onclick: function () { urlZeileDazu({}).focus(); } }, [zeichen('plus'), t('edit.adresseDazu')])
    ]);

    var zusatz = el('div', { 'class': 'feld' }, [
      el('span', { 'class': 'feld__name', text: t('edit.zusatz') }),
      el('p', { 'class': 'feld__info', text: t('edit.zusatzHinweis') }),
      feldZeilen,
      el('div', { 'class': 'chips' }, [
        vorlage(t('edit.vorlagePin'), true),
        vorlage(t('edit.vorlageKunde'), false),
        vorlage(t('edit.vorlageFrage'), false),
        vorlage(t('edit.vorlageAntwort'), true),
        el('button', { 'class': 'chip chip--dazu', type: 'button', onclick: function () { feldZeileDazu({}).focus(); } }, [zeichen('plus'), t('edit.feldDazu')])
      ])
    ]);

    var leib = [
      el('div', { 'class': 'edit-symbol' }, [
        vorschau,
        el('div', { 'class': 'edit-symbol__rechts' }, [
          feld(t('edit.titel'), fTitel),
          el('div', { 'class': 'edit-symbol__reihe' }, [fEmoji, farben])
        ])
      ]),
      feld(t('edit.adresse'), fUrl),
      weitereAdressen,
      el('div', { 'class': 'feld-reihe' }, [feld(t('edit.reiter'), fKat), feld(t('edit.schlagwoerter'), fTags, tagVorschlaege ? [tagVorschlaege] : [])]),
      feld(t('edit.benutzer'), fUser, null, t('edit.benutzerHinweis')),
      feld(t('edit.passwort'), passGruppe, [staerke.knoten, dublette, verlaufHinweis]),
      zusatz,
      feld(t('edit.notiz'), fNotiz),
      el('label', { 'class': 'schalter', 'for': 'e-fav' }, [fFav, el('span', { 'class': 'schalter__spur', 'aria-hidden': 'true' }), el('span', { text: t('edit.favorit') })])
    ];
    passwortPruefen();

    function sichern() {
      var titel = fTitel.value.trim();
      var url = fUrl.value.trim();
      if (!titel && !url) { zuruf(t('edit.fehlerLeer'), true); fTitel.focus(); return; }
      it.title = titel || V.hostOf(url) || t('allg.ohneTitel');
      it.url = url;
      it.user = fUser.value.trim();
      if (neu) { it.pass = fPass.value; it.passChangedAt = fPass.value ? jetzt() : null; }
      else { V.setPassword(it, fPass.value); }
      it.note = fNotiz.value;
      it.cat = fKat.value || null;
      it.tags = V.parseTags(fTags.value);
      it.emoji = V.sanitizeEmoji(fEmoji.value);
      it.color = farbeWahl;
      it.fav = fFav.checked;
      it.urls = Array.prototype.map.call(urlZeilen.children, function (z) { return z._lesen(); })
        .filter(function (u) { return u.url.trim(); })
        .map(function (u) { return { label: u.label.trim().slice(0, 60), url: u.url.trim() }; });
      it.fields = Array.prototype.map.call(feldZeilen.children, function (z) { return z._lesen(); })
        .filter(function (f) { return f.label.trim() || f.value; })
        .map(function (f) { return { label: f.label.trim().slice(0, 60), value: f.value, hidden: !!f.hidden }; });
      it.updatedAt = jetzt();
      if (neu) {
        /* Neue Karten ans Ende der eigenen Reihenfolge. */
        var max = 0;
        Z.daten.items.forEach(function (x) { if (!x.deletedAt && (x.order || 0) > max) { max = x.order || 0; } });
        it.order = max + 1;
        Z.daten.items.push(it);
      }
      schmutzig(true);
      vorhangZu();
      zeichnen();
      zuruf(neu ? t('edit.angelegt') : t('edit.geaendert'));
    }

    var fuss = [];
    if (!neu) {
      fuss.push(el('button', { 'class': 'knopf knopf--gefahr', onclick: function () { loeschenFragen(it); } }, [zeichen('muell'), t('allg.loeschen')]));
    }
    fuss.push(el('span', { 'class': 'blatt__luft' }));
    fuss.push(el('button', { 'class': 'knopf', text: t('allg.abbrechen'), onclick: vorhangZu }));
    fuss.push(el('button', { 'class': 'knopf knopf--haupt', id: 'b-uebernehmen', text: t('allg.uebernehmen'), onclick: sichern }));

    var blatt = blattBauen({ titel: neu ? t('edit.neu') : t('edit.aendern'), leib: leib, fuss: fuss, breit: true, klasse: 'blatt--edit' });
    blatt.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sichern(); }
    });
    vorhangAuf(blatt, false);
    setTimeout(function () { fTitel.focus(); }, 30);
  }

  function loeschenFragen(it) {
    /* Kein Nachfragen nötig: gelöscht heißt in den Papierkorb, und von dort
     * ist alles zurückholbar. Ein Zug, sofort rückgängig zu machen. */
    it.deletedAt = jetzt();
    it.fav = false;
    it.updatedAt = jetzt();
    schmutzig(true);
    vorhangZu();
    zeichnen();
    zurufMitZurueck(t('muell.gelegt'), function () {
      it.deletedAt = null; it.updatedAt = jetzt();
      schmutzig(true); zeichnen(); zuruf(t('muell.zurueckgeholt'));
    });
  }

  /* ------------------------------------------------- Passwortgenerator */

  function generatorZeigen(uebernehmen, ueberEditor) {
    var o = { modus: 'zufall', laenge: 20, gross: true, zahl: true, zeichen: true, woerter: 5, trenner: '-', zahlDran: true };
    var ausgabe = el('output', { 'class': 'generator__ausgabe mono', id: 'gen-ausgabe', 'aria-live': 'polite' });
    var staerke = staerkeBauen();
    var optionen = el('div', { 'class': 'generator__optionen' });

    function wuerfeln() {
      var pw = o.modus === 'merksatz'
        ? V.generatePassphrase({ words: o.woerter, sep: o.trenner, zahl: o.zahlDran })
        : V.generatePassword({ length: o.laenge, gross: o.gross, zahl: o.zahl, zeichen: o.zeichen });
      ausgabe.textContent = pw;
      staerke.zeigen(pw);
    }

    function schalter(text, schl) {
      var cb = el('input', { type: 'checkbox' });
      cb.checked = !!o[schl];
      cb.addEventListener('change', function () { o[schl] = cb.checked; wuerfeln(); });
      return el('label', { 'class': 'schalter' }, [cb, el('span', { 'class': 'schalter__spur', 'aria-hidden': 'true' }), el('span', { text: text })]);
    }

    function optionenZeichnen() {
      leeren(optionen);
      if (o.modus === 'zufall') {
        var lText = el('span', { 'class': 'feld__name', text: t('gen.laenge', { n: o.laenge }) });
        var regler = el('input', { type: 'range', min: '8', max: '64', value: String(o.laenge), 'class': 'regler', 'aria-label': t('gen.laenge', { n: o.laenge }) });
        regler.addEventListener('input', function () { o.laenge = parseInt(regler.value, 10); lText.textContent = t('gen.laenge', { n: o.laenge }); wuerfeln(); });
        optionen.appendChild(el('div', { 'class': 'feld' }, [lText, regler]));
        optionen.appendChild(schalter(t('gen.gross'), 'gross'));
        optionen.appendChild(schalter(t('gen.ziffern'), 'zahl'));
        optionen.appendChild(schalter(t('gen.zeichen'), 'zeichen'));
      } else {
        var wText = el('span', { 'class': 'feld__name', text: t('gen.woerter', { n: o.woerter }) });
        var wRegler = el('input', { type: 'range', min: '3', max: '10', value: String(o.woerter), 'class': 'regler', 'aria-label': t('gen.woerter', { n: o.woerter }) });
        wRegler.addEventListener('input', function () { o.woerter = parseInt(wRegler.value, 10); wText.textContent = t('gen.woerter', { n: o.woerter }); wuerfeln(); });
        optionen.appendChild(el('div', { 'class': 'feld' }, [wText, wRegler]));
        var trenner = el('select', { 'class': 'eingabe eingabe--klein', 'aria-label': t('gen.trenner') });
        ['-', '.', '_', ' ', ''].forEach(function (s) {
          var op = el('option', { value: s, text: s === ' ' ? '␣' : (s === '' ? '∅' : s) });
          if (s === o.trenner) { op.selected = true; }
          trenner.appendChild(op);
        });
        trenner.addEventListener('change', function () { o.trenner = trenner.value; wuerfeln(); });
        optionen.appendChild(feld(t('gen.trenner'), trenner));
        optionen.appendChild(schalter(t('gen.zahlDran'), 'zahlDran'));
      }
    }

    var modi = el('div', { 'class': 'umschalter umschalter--text', role: 'tablist' });
    function modiZeichnen() {
      leeren(modi);
      ['zufall', 'merksatz'].forEach(function (m) {
        modi.appendChild(el('button', {
          'class': 'umschalter__knopf' + (o.modus === m ? ' umschalter__knopf--an' : ''), role: 'tab',
          'aria-selected': o.modus === m ? 'true' : 'false', text: t('gen.' + m),
          onclick: function () { o.modus = m; modiZeichnen(); optionenZeichnen(); wuerfeln(); }
        }));
      });
    }
    modiZeichnen();
    optionenZeichnen();
    wuerfeln();

    var fuss = [
      el('button', { 'class': 'knopf', onclick: wuerfeln }, [zeichen('wuerfel'), t('gen.neu')]),
      el('span', { 'class': 'blatt__luft' }),
      el('button', { 'class': 'knopf', onclick: function () { kopiere(ausgabe.textContent, t('was.passwort')); } }, [zeichen('kopieren'), t('allg.kopieren')])
    ];
    if (uebernehmen) {
      fuss.push(el('button', { 'class': 'knopf knopf--haupt', text: t('gen.nehmen'), onclick: function () { var pw = ausgabe.textContent; generatorSchliessen(); uebernehmen(pw); } }));
    }

    /* Aus dem Editor heraus liegt der Generator ÜBER dem Editor: der Editor
     * wird nur versteckt, nicht abgebaut, damit nichts Eingetipptes verloren
     * geht. */
    var editor = ueberEditor ? document.querySelector('#vorhang-halter .vorhang') : null;
    var eigenerVorhang = null;
    function generatorSchliessen() {
      if (editor) { eigenerVorhang.remove(); editor.classList.remove('versteckt'); var f = document.getElementById('e-pass'); if (f) { f.focus(); } }
      else { vorhangZu(); }
    }
    var blatt = blattBauen({
      titel: t('gen.titel'), leib: [modi, el('div', { 'class': 'generator' }, [ausgabe, staerke.knoten]), optionen, el('p', { 'class': 'leise klein', text: t('gen.hinweis') })],
      fuss: fuss, schmal: true, zu: generatorSchliessen
    });
    if (editor) {
      editor.classList.add('versteckt');
      eigenerVorhang = el('div', { 'class': 'vorhang' }, [blatt]);
      eigenerVorhang._schliessen = generatorSchliessen;
      $('vorhang-halter').appendChild(eigenerVorhang);
      fokusFalle(eigenerVorhang, blatt);
    } else {
      vorhangAuf(blatt);
    }
  }

  /* ------------------------------------------------- Reiter verwalten */

  function reiterVerwalten() {
    function sortierteKats() {
      return Z.daten.categories.slice().sort(function (a, b) { return a.order - b.order; });
    }
    function ordneNeu() { sortierteKats().forEach(function (c, i) { c.order = i; }); }
    function neuZeichnen() { vorhangZu(); reiterVerwalten(); zeichnen(); }
    function verschiebe(c, richtung) {
      ordneNeu();
      var liste = sortierteKats();
      var i = liste.indexOf(c);
      var j = i + richtung;
      if (j < 0 || j >= liste.length) { return; }
      var tmp = liste[i].order; liste[i].order = liste[j].order; liste[j].order = tmp;
      schmutzig(true);
      neuZeichnen();
    }

    function zeileBauen(c, i, gesamt) {
      var name = el('input', { 'class': 'eingabe eingabe--klein', type: 'text', value: c.name, maxlength: '40', 'aria-label': t('nav.reiter') });
      name.addEventListener('input', function () { c.name = name.value; schmutzig(true); navZeichnen(); });

      var farbe = el('select', { 'class': 'eingabe eingabe--klein', 'aria-label': t('edit.farbe') });
      V.CATEGORY_COLORS.forEach(function (f) {
        var o = el('option', { value: f, text: t('farbe.' + f) });
        if (c.color === f) { o.selected = true; }
        farbe.appendChild(o);
      });
      var punkt = el('span', { 'class': 'nav__punkt nav__punkt--gross', stil: '--f:var(--kat-' + c.color + ')' });
      farbe.addEventListener('change', function () {
        c.color = farbe.value; schmutzig(true);
        punkt.style.setProperty('--f', 'var(--kat-' + c.color + ')');
        navZeichnen();
      });

      return el('div', { 'class': 'zeile zeile--reiter' }, [
        punkt, name, farbe,
        el('button', { 'class': 'tun', title: t('reiter.hoch'), 'aria-label': t('reiter.hoch'), disabled: i === 0, onclick: function () { verschiebe(c, -1); } }, [zeichen('hoch')]),
        el('button', { 'class': 'tun', title: t('reiter.runter'), 'aria-label': t('reiter.runter'), disabled: i === gesamt - 1, onclick: function () { verschiebe(c, 1); } }, [zeichen('runter')]),
        el('button', {
          'class': 'tun tun--gefahr', title: t('reiter.loeschen'), 'aria-label': t('reiter.loeschen'),
          onclick: function () {
            Z.daten.items.forEach(function (it) { if (it.cat === c.id) { it.cat = null; } });
            Z.daten.categories = Z.daten.categories.filter(function (x) { return x.id !== c.id; });
            if (Z.kategorie === c.id) { Z.ansicht = 'alle'; Z.kategorie = null; }
            schmutzig(true);
            neuZeichnen();
          }
        }, [zeichen('muell')])
      ]);
    }

    var leib = [];
    var kats = sortierteKats();
    var zeilen = el('div', { 'class': 'zeilen' });
    kats.forEach(function (c, i) { zeilen.appendChild(zeileBauen(c, i, kats.length)); });
    leib.push(zeilen);
    if (kats.length === 0) { leib.push(el('p', { 'class': 'leise', text: t('reiter.leer') })); }
    else { leib.push(el('p', { 'class': 'leise klein', text: t('reiter.loeschenInfo') })); }

    var neuName = el('input', { 'class': 'eingabe', type: 'text', placeholder: t('reiter.neuPh'), maxlength: '40', id: 'reiter-neu' });
    function anlegen() {
      var n = neuName.value.trim();
      if (!n) { return; }
      var c = V.newCategory(n, V.CATEGORY_COLORS[Z.daten.categories.length % V.CATEGORY_COLORS.length]);
      c.order = Z.daten.categories.length;
      Z.daten.categories.push(c);
      schmutzig(true);
      neuZeichnen();
      var f = $('reiter-neu'); if (f) { f.focus(); }
    }
    neuName.addEventListener('keydown', function (e) { if (e.key === 'Enter') { anlegen(); } });
    leib.push(el('div', { 'class': 'eingabe-gruppe eingabe-gruppe--abstand' }, [
      neuName,
      el('button', { 'class': 'knopf knopf--haupt', title: t('reiter.anlegen'), 'aria-label': t('reiter.anlegen'), onclick: anlegen }, [zeichen('plus'), t('allg.hinzufuegen')])
    ]));

    vorhangAuf(blattBauen({
      titel: t('reiter.titel'), leib: leib,
      fuss: [el('span', { 'class': 'blatt__luft' }), el('button', { 'class': 'knopf knopf--haupt', text: t('allg.fertig'), onclick: vorhangZu })]
    }));
  }

  /* ------------------------------------------------- Sicherheit */

  function sicherheitZeichnen(inh) {
    var d = Z.daten;
    var a = V.audit(d);
    inh.appendChild(kopfBauen(t('sich.titel'), null, false));

    var farbe = a.note >= 90 ? 'gruen' : (a.note >= 60 ? 'gelb' : 'rot');
    var umfang = 2 * Math.PI * 42;
    var ring = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--linie)" stroke-width="9"/>' +
      '<circle cx="50" cy="50" r="42" fill="none" stroke="var(--' + farbe + ')" stroke-width="9" stroke-linecap="round" ' +
      'stroke-dasharray="' + (umfang * a.note / 100).toFixed(1) + ' ' + umfang.toFixed(1) + '" transform="rotate(-90 50 50)"/></svg>';

    inh.appendChild(el('div', { 'class': 'sicherheit-kopf' }, [
      el('div', { 'class': 'ring' }, [
        el('div', { 'class': 'ring__bild', html: ring }),
        el('div', { 'class': 'ring__zahl', id: 'sicherheit-note' }, [el('strong', { text: String(a.note) }), el('span', { text: '%' })])
      ]),
      el('div', { 'class': 'sicherheit-kopf__text' }, [
        el('h2', { 'class': 'sicherheit-kopf__titel', text: a.note >= 90 ? t('sich.gut') : (a.note >= 60 ? t('sich.mittel') : t('sich.schlecht')) }),
        el('p', { 'class': 'leise', text: tn('sich.geprueft', a.mitPasswort) }),
        el('p', { 'class': 'leise klein', text: t('sich.offline') })
      ])
    ]));

    var monate = d.settings.maxAgeMonths;
    var bloecke = [
      { schl: 'doppelt', n: a.doppelt.length, text: t('sich.doppelt'), farbe: 'rot' },
      { schl: 'schwach', n: a.schwach.length, text: t('sich.schwach'), farbe: 'gelb' },
      { schl: 'alt', n: a.alt.length, text: t('sich.alt'), farbe: 'gelb', aus: !monate },
      { schl: 'unsicher', n: a.unsicher.length, text: t('sich.unsicher'), farbe: 'rot' }
    ];
    inh.appendChild(el('div', { 'class': 'zahlen' }, bloecke.map(function (b) {
      return el('div', { 'class': 'zahl zahl--statisch' + (b.n ? ' zahl--' + b.farbe : ' zahl--gruen') + (b.aus ? ' zahl--aus' : '') }, [
        el('span', { 'class': 'zahl__wert', text: b.aus ? '–' : String(b.n) }),
        el('span', { 'class': 'zahl__text', text: b.text })
      ]);
    })));

    if (a.aufgaben === 0) {
      inh.appendChild(el('div', { 'class': 'hinweis hinweis--gut' }, [
        zeichen('schildOk'),
        el('p', { text: a.mitPasswort === 0 ? t('sich.nochNichts') : t('sich.allesGut') })
      ]));
    }

    function reihe(it, extra) {
      return el('button', {
        'class': 'sich-reihe', 'data-id': it.id,
        onclick: function () { blattBearbeiten(it); }
      }, [
        symbolBauen(it, 'sich-reihe__symbol'),
        el('span', { 'class': 'sich-reihe__titel', text: titelVon(it) }),
        el('span', { 'class': 'sich-reihe__extra', text: extra }),
        zeichen('rechts')
      ]);
    }
    function block(titel, text, farbe, kinder) {
      return el('section', { 'class': 'sich-block' }, [
        el('div', { 'class': 'sich-block__kopf' }, [
          el('span', { 'class': 'sich-block__punkt', stil: 'background:var(--' + farbe + ')' }),
          el('h3', { 'class': 'sich-block__titel', text: titel }),
          el('p', { 'class': 'sich-block__text', text: text })
        ])
      ].concat(kinder));
    }

    if (a.doppelt.length) {
      inh.appendChild(block(t('sich.doppelt'), t('sich.doppeltText'), 'rot', a.doppelt.map(function (gr) {
        return el('div', { 'class': 'sich-gruppe' }, gr.map(function (it) { return reihe(it, t('sich.mal', { n: gr.length })); }));
      })));
    }
    if (a.schwach.length) {
      inh.appendChild(block(t('sich.schwach'), t('sich.schwachText'), 'gelb', a.schwach.map(function (it) {
        return reihe(it, t('allg.bit', { n: V.ratePassword(it.pass).bits }));
      })));
    }
    if (a.alt.length) {
      inh.appendChild(block(t('sich.alt'), t('sich.altText', { n: monate }), 'gelb', a.alt.map(function (it) {
        return reihe(it, I18N.vorTagen(V.passwordAgeDays(it)));
      })));
    }
    if (a.unsicher.length) {
      inh.appendChild(block(t('sich.unsicher'), t('sich.unsicherText'), 'rot', a.unsicher.map(function (it) {
        return reihe(it, 'http://');
      })));
    }
    if (a.aufgaben) { inh.appendChild(el('p', { 'class': 'leise klein', text: t('sich.fuss') })); }

    var b = V.backupFaellig(d);
    inh.appendChild(el('section', { 'class': 'sich-block' }, [
      el('div', { 'class': 'sich-block__kopf' }, [
        el('span', { 'class': 'sich-block__punkt', stil: 'background:var(--' + (b.faellig ? 'gelb' : 'gruen') + ')' }),
        el('h3', { 'class': 'sich-block__titel', text: t('sich.sicherung') }),
        el('p', { 'class': 'sich-block__text', text: d.settings.lastBackupAt ? t('sich.sicherungVor', { wann: I18N.vorTagen(b.tage) }) : t('sich.sicherungNie') })
      ]),
      el('button', { 'class': 'knopf', onclick: sicherungHerunterladen }, [zeichen('sicherung'), t('sich.sicherungKnopf')])
    ]));
  }

  /* Für Tests und alte Aufrufer: öffnet die Sicherheitsansicht. */
  function kassensturzZeigen() { geheZu('sicherheit'); }

  /* ------------------------------------------------- Import */

  function importZeigen() {
    var stand = el('div', { 'class': 'import-stand' });
    var dateiKnopf = el('input', { type: 'file', accept: '.csv,.html,.htm,text/csv,text/html', 'class': 'nur-lesen', id: 'import-datei' });

    function setStand(text, warn) {
      leeren(stand);
      stand.appendChild(el('p', { 'class': warn ? 'feld__fehler' : 'leise', text: text }));
    }

    function verarbeiten(datei) {
      if (!datei) { return; }
      if (datei.size > 40 * 1024 * 1024) { setStand(t('imp.zuGross'), true); return; }
      var leser = new FileReader();
      leser.onerror = function () { setStand(t('imp.unlesbar'), true); };
      leser.onload = function () {
        var text = String(leser.result || '');
        var istHtml = /\.html?$/i.test(datei.name) || /<a\s[^>]*href/i.test(text.slice(0, 4000));
        var ergebnis;
        try { ergebnis = istHtml ? V.importBookmarks(text) : V.importCsv(text); }
        catch (e) { setStand(t('imp.fehler', { text: e.message }), true); return; }
        vorschau(ergebnis, istHtml ? t('imp.ausLz') : t('imp.ausCsv'));
      };
      leser.readAsText(datei);
    }

    function vorschau(ergebnis, quelle) {
      leeren(stand);
      if (ergebnis.items.length === 0) { setStand(t('imp.nichts'), true); return; }
      var mitPass = ergebnis.items.filter(function (it) { return it.pass; }).length;
      var lese = ergebnis.items.length - mitPass;
      stand.appendChild(el('div', { 'class': 'import-vorschau' }, [
        el('p', { 'class': 'import-vorschau__zahl', text: String(ergebnis.items.length) }),
        el('p', { 'class': 'import-vorschau__text', text: quelle }),
        el('ul', { 'class': 'import-vorschau__liste' }, [
          el('li', { text: tn('imp.mitPass', mitPass) }),
          el('li', { text: tn('imp.lese', lese) }),
          el('li', { text: tn('imp.kat', ergebnis.categories.length) })
        ]),
        el('button', {
          'class': 'knopf knopf--haupt', id: 'b-import-uebernehmen', text: t('imp.uebernehmen', { n: ergebnis.items.length }),
          onclick: function () {
            var e = V.mergeImport(Z.daten, ergebnis);
            schmutzig(true);
            vorhangZu();
            zeichnen();
            var teile = [t('imp.ergebnis', { n: e.neueItems })];
            if (e.dubletten > 0) { teile.push(t('imp.dubletten', { n: e.dubletten })); }
            zuruf(teile.join(' · '));
          }
        }),
        ergebnis.uebersprungen > 0 ? el('p', { 'class': 'leise klein', text: t('imp.leerZeilen', { n: ergebnis.uebersprungen }) }) : null
      ]));
    }

    dateiKnopf.addEventListener('change', function (e) { verarbeiten(e.target.files[0]); e.target.value = ''; });

    var ablage = el('div', { 'class': 'ablage ablage--klein', tabindex: '0', role: 'button' }, [
      el('span', { 'class': 'ablage__symbol' }, [zeichen('import')]),
      el('strong', { text: t('imp.ablage') }),
      el('span', { 'class': 'ablage__unter', text: t('imp.ablageUnter') })
    ]);
    ablage.addEventListener('click', function () { dateiKnopf.click(); });
    ablage.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dateiKnopf.click(); } });
    ablage.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); ablage.classList.add('ablage--bereit'); });
    ablage.addEventListener('dragleave', function () { ablage.classList.remove('ablage--bereit'); });
    ablage.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); ablage.classList.remove('ablage--bereit');
      if (e.dataTransfer && e.dataTransfer.files[0]) { verarbeiten(e.dataTransfer.files[0]); }
    });

    vorhangAuf(blattBauen({
      titel: t('imp.titel'),
      leib: [
        el('p', { 'class': 'absatz leise' }, [t('imp.text1'), el('b', { text: t('imp.text2') }), t('imp.text3')]),
        ablage, dateiKnopf, stand
      ],
      fuss: [el('span', { 'class': 'blatt__luft' }), el('button', { 'class': 'knopf', text: t('allg.schliessen'), onclick: vorhangZu })]
    }));
  }

  /* ------------------------------------------------- Master-Passwort ändern */

  function masterAendern() {
    var alt = el('input', { 'class': 'eingabe', type: 'password', autocomplete: 'current-password', placeholder: t('master.altPh'), id: 'm-alt' });
    var neu1 = el('input', { 'class': 'eingabe', type: 'password', autocomplete: 'new-password', placeholder: t('master.neuPh'), id: 'm-neu1' });
    var neu2 = el('input', { 'class': 'eingabe', type: 'password', autocomplete: 'new-password', placeholder: t('master.neu2Ph'), id: 'm-neu2' });
    var fehler = el('p', { 'class': 'feld__fehler versteckt', role: 'alert' });
    var staerke = staerkeBauen();
    neu1.addEventListener('input', function () { staerke.zeigen(neu1.value); });

    function zeigeFehler(text) { fehler.textContent = text; fehler.classList.remove('versteckt'); }

    vorhangAuf(blattBauen({
      titel: t('master.titel'), schmal: true,
      leib: [
        feld(t('master.alt'), alt),
        feld(t('master.neu'), neu1, [staerke.knoten]),
        feld(t('master.neu2'), neu2),
        fehler,
        el('p', { 'class': 'leise klein', text: t('master.hinweis') })
      ],
      fuss: [
        el('button', { 'class': 'knopf', text: t('allg.abbrechen'), onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--haupt', id: 'b-master', text: t('master.knopf'),
          onclick: function () {
            fehler.classList.add('versteckt');
            if (alt.value !== Z.passwort) { zeigeFehler(t('master.fehlerAlt')); return; }
            if (neu1.value.length < 12) { zeigeFehler(t('master.fehlerKurz')); return; }
            if (neu1.value !== neu2.value) { zeigeFehler(t('master.fehlerGleich')); return; }
            if (V.ratePassword(neu1.value).stufe < 2) { zeigeFehler(t('master.fehlerSchwach')); return; }
            if (neu1.value === Z.passwort) { zeigeFehler(t('master.fehlerSelbe')); return; }
            Z.passwort = neu1.value;
            Z.kdf = geraeteKdf();
            schmutzig(true);
            vorhangZu();
            speichern().then(function (ok) { if (ok) { zuruf(t('master.fertig')); } });
          }
        })
      ]
    }), false);
    setTimeout(function () { alt.focus(); }, 30);
  }

  /* ------------------------------------------------- Notfallzettel */

  function notfallzettelZeigen() {
    var vorschlagDatei = (Z.dateiHandle && Z.dateiHandle.name) ? Z.dateiHandle.name : (sauberName() + '.peter');
    var fProgramm = el('input', { 'class': 'eingabe', type: 'text', placeholder: t('nz.programmPh'), value: '' });
    var fDatei = el('input', { 'class': 'eingabe', type: 'text', value: vorschlagDatei });

    vorhangAuf(blattBauen({
      titel: t('nz.titel'), schmal: true,
      symbol: el('span', { 'class': 'blatt__symbol blatt__symbol--zeichen' }, [zeichen('zettel')]),
      leib: [
        el('p', { 'class': 'absatz leise' }, [t('nz.text1'), el('b', { text: t('nz.text2') }), t('nz.text3'), el('b', { text: t('nz.text4') }), t('nz.text5')]),
        feld(t('nz.datei'), fDatei),
        feld(t('nz.programm'), fProgramm)
      ],
      fuss: [
        el('button', { 'class': 'knopf', text: t('allg.abbrechen'), onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--haupt', onclick: function () { notfallDrucken({ datei: fDatei.value.trim(), programm: fProgramm.value.trim() }); }
        }, [zeichen('drucken'), t('nz.drucken')])
      ]
    }), false);
    setTimeout(function () { fProgramm.focus(); }, 30);
  }

  function notfallDrucken(ort) {
    var tx = V.notfallText(Z.daten, ort, I18N.lang());
    var druck = $('druck-halter');
    leeren(druck);

    function zeile(label, wert) {
      return el('div', { 'class': 'nz-zeile' }, [
        el('span', { 'class': 'nz-label', text: label }),
        el('span', { 'class': 'nz-wert', text: wert || '________________________' })
      ]);
    }

    druck.appendChild(el('div', { 'class': 'nz-blatt' }, [
      el('div', { 'class': 'nz-kopf' }, [
        el('div', { 'class': 'nz-siegel', html: Seal.svg(tx.tresor, tx.tresor) }),
        el('div', {}, [
          el('h1', { 'class': 'nz-titel', text: t('nz.titel') }),
          el('p', { 'class': 'nz-unter', text: 'PasswortPeter · ' + tx.datum })
        ])
      ]),
      el('div', { 'class': 'nz-abschnitt' }, [
        zeile(t('nz.tresor'), tx.tresor),
        zeile(t('nz.tresordatei'), tx.dateiOrt),
        zeile(t('nz.programmBei'), tx.programmOrt)
      ]),
      el('div', { 'class': 'nz-passwortkasten' }, [
        el('p', { 'class': 'nz-passwortkasten__label', text: t('nz.pwKasten') }),
        el('div', { 'class': 'nz-linie' }),
        el('div', { 'class': 'nz-linie' })
      ]),
      el('div', { 'class': 'nz-abschnitt' }, [
        el('p', { 'class': 'nz-h', text: t('nz.so') }),
        el('ol', { 'class': 'nz-schritte' }, tx.schritte.map(function (s) { return el('li', { text: s }); }))
      ]),
      el('div', { 'class': 'nz-warnung', text: tx.warnung }),
      el('p', { 'class': 'nz-fuss', text: t('nz.fuss') })
    ]));

    document.body.classList.add('drucke-nz');
    vorhangZu();

    /* Erst nach dem Zeichnen drucken. Nach dem Druck (oder Abbruch) die
     * Druckansicht wieder verstecken. */
    var fertig = function () {
      document.body.classList.remove('drucke-nz');
      leeren(druck);
      window.removeEventListener('afterprint', fertig);
    };
    window.addEventListener('afterprint', fertig);
    setTimeout(function () {
      if (typeof window.print === 'function') { window.print(); }
      /* Falls afterprint nie kommt (manche Browser), nach 60 s aufräumen. */
      setTimeout(function () { if (document.body.classList.contains('drucke-nz')) { fertig(); } }, 60000);
    }, 60);
  }

  /* ------------------------------------------------- Einstellungen */

  function einstellungenZeigen() {
    var s = V.sanitizeSettings(Z.daten.settings);

    function auswahl(id, werte, aktuell) {
      var sel = el('select', { 'class': 'eingabe', id: id });
      werte.forEach(function (o) {
        var opt = el('option', { value: String(o.v), text: o.t });
        if (String(o.v) === String(aktuell)) { opt.selected = true; }
        sel.appendChild(opt);
      });
      return sel;
    }

    var fLang = auswahl('s-lang', [{ v: 'de', t: 'Deutsch' }, { v: 'en', t: 'English' }], s.lang);
    var fThema = auswahl('s-thema', [{ v: 'auto', t: t('einst.themaAuto') }, { v: 'hell', t: t('einst.themaHell') }, { v: 'dunkel', t: t('einst.themaDunkel') }], s.theme);
    var fAnsicht = auswahl('s-ansicht', [{ v: 'kacheln', t: t('einst.ansichtKacheln') }, { v: 'liste', t: t('einst.ansichtListe') }], s.view);
    var fLock = auswahl('s-lock', V.AUTO_LOCK_WERTE.map(function (m) { return { v: m, t: m === 0 ? t('einst.nie') : tn('einst.min', m) }; }), s.autoLockMin);
    var fKdf = auswahl('s-kdf', [{ v: 'sparsam', t: t('einst.kdfSparsam') }, { v: 'standard', t: t('einst.kdfStandard') }, { v: 'streng', t: t('einst.kdfStreng') }], s.kdf);
    var fAlter = auswahl('s-alter', V.MAX_AGE_WERTE.map(function (m) { return { v: m, t: m === 0 ? t('einst.alterAus') : tn('sich.monate', m) }; }), s.maxAgeMonths);
    var fSich = auswahl('s-sicherung', V.BACKUP_WERTE.map(function (d) { return { v: d, t: d === 0 ? t('einst.sicherungAus') : t('einst.tage.n', { n: d }) }; }), s.backupDays);

    /* Das Erscheinungsbild gleich zeigen, nicht erst nach dem Übernehmen. */
    fThema.addEventListener('change', function () { themaAnwenden(fThema.value); });

    function hinweis(text) { return el('p', { 'class': 'feld__info', text: text }); }

    vorhangAuf(blattBauen({
      titel: t('einst.titel'),
      symbol: el('span', { 'class': 'blatt__symbol blatt__symbol--zeichen' }, [zeichen('zahnrad')]),
      leib: [
        el('h3', { 'class': 'blatt__h', text: t('einst.gruppeAussehen') }),
        el('div', { 'class': 'feld-reihe' }, [feld(t('einst.sprache'), fLang), feld(t('einst.thema'), fThema)]),
        feld(t('einst.ansicht'), fAnsicht),
        el('h3', { 'class': 'blatt__h', text: t('einst.gruppeSicherheit') }),
        feld(t('einst.sperre'), fLock, [hinweis(t('einst.sperreHinweis'))]),
        feld(t('einst.kdf'), fKdf, [hinweis(t('einst.kdfHinweis'))]),
        el('h3', { 'class': 'blatt__h', text: t('einst.gruppeErinnerung') }),
        feld(t('einst.alter'), fAlter, [hinweis(t('einst.alterHinweis'))]),
        feld(t('einst.sicherung'), fSich)
      ],
      fuss: [
        el('span', { 'class': 'blatt__luft' }),
        el('button', { 'class': 'knopf', text: t('allg.abbrechen'), onclick: function () { themaAnwenden(s.theme); vorhangZu(); } }),
        el('button', {
          'class': 'knopf knopf--haupt', id: 'b-einst-uebernehmen', text: t('allg.uebernehmen'),
          onclick: function () {
            var neu = V.sanitizeSettings({
              autoLockMin: parseInt(fLock.value, 10), kdf: fKdf.value,
              lang: fLang.value, theme: fThema.value, view: fAnsicht.value,
              maxAgeMonths: parseInt(fAlter.value, 10), backupDays: parseInt(fSich.value, 10),
              lastBackupAt: s.lastBackupAt
            });
            var kdfGeaendert = neu.kdf !== s.kdf;
            var ansichtGeaendert = neu.view !== s.view;
            Z.daten.settings = neu;
            if (kdfGeaendert) { Z.kdf = geraeteKdf(); }
            if (ansichtGeaendert) { Z.darstellung = neu.view; }
            themaAnwenden(neu.theme);
            schmutzig(true);
            vorhangZu();
            if (neu.lang !== I18N.lang()) { spracheSetzen(neu.lang); } else { zeichnen(); }
            ruheAnstossen();
            zuruf(kdfGeaendert ? t('einst.fertigKdf') : t('einst.fertig'));
          }
        })
      ]
    }));
  }

  /* ------------------------------------------------- Über */

  function ueberZeigen() {
    vorhangAuf(blattBauen({
      titel: t('ueber.titel'), schmal: true,
      symbol: el('span', { 'class': 'blatt__symbol blatt__symbol--logo', html: LOGO }),
      unter: t('ueber.version', { v: APP_VERSION }) + ' · ' + t('ueber.format', { v: V.FORMAT_VERSION }),
      leib: [
        el('p', { 'class': 'absatz', text: t('ueber.text') }),
        el('ul', { 'class': 'liste-haken' }, ['ueber.p1', 'ueber.p2', 'ueber.p3', 'ueber.p4'].map(function (k) { return el('li', { text: t(k) }); })),
        Z.kdf ? el('p', { 'class': 'leise klein mono', text: t('ueber.kdfJetzt', { mib: Math.round(Z.kdf.memKiB / 1024), ops: Z.kdf.ops }) }) : null
      ],
      fuss: [el('span', { 'class': 'blatt__luft' }), el('button', { 'class': 'knopf knopf--haupt', text: t('allg.fertig'), onclick: vorhangZu })]
    }));
  }

  /* ------------------------------------------------- Menü */

  function menueZeigen() {
    function eintrag(symbol, text, klick, gefahr) {
      return el('button', {
        'class': 'menue__eintrag' + (gefahr ? ' menue__eintrag--gefahr' : ''),
        onclick: function () { vorhangZu(); klick(); }
      }, [zeichen(symbol), el('span', { text: text })]);
    }
    function gruppe(titel, kinder) {
      return el('div', { 'class': 'menue__gruppe' }, [el('p', { 'class': 'menue__kopf', text: titel })].concat(kinder));
    }
    vorhangAuf(blattBauen({
      titel: Z.daten.name, schmal: true, klasse: 'blatt--menue',
      symbol: siegel('blatt__symbol', Z.daten.name, Z.daten.name),
      leib: [
        gruppe(t('menue.gruppeTresor'), [
          eintrag('schild', t('menue.sicherheit'), function () { geheZu('sicherheit'); }),
          eintrag('wuerfel', t('menue.generator'), function () { generatorZeigen(); }),
          eintrag('zettel', t('menue.notfall'), notfallzettelZeigen),
          eintrag('schloss', t('menue.master'), masterAendern)
        ]),
        gruppe(t('menue.gruppeDaten'), [
          eintrag('import', t('menue.import'), importZeigen),
          eintrag('lesezeichen', t('menue.lesezeichen'), lesezeichenExportieren),
          eintrag('sicherung', t('menue.sicherung'), sicherungHerunterladen),
          eintrag('warn', t('menue.csv'), exportFragen, true)
        ]),
        gruppe(t('menue.gruppeApp'), [
          eintrag('zahnrad', t('menue.einstellungen'), einstellungenZeigen),
          eintrag('info', t('menue.ueber'), ueberZeigen)
        ])
      ]
    }));
  }

  function exportFragen() {
    vorhangAuf(blattBauen({
      titel: t('csv.frage'), rolle: 'alertdialog', schmal: true,
      leib: [el('div', { 'class': 'hinweis hinweis--gefahr' }, [
        zeichen('warn'),
        el('p', {}, [el('strong', { text: t('csv.warnung') }), t('csv.text')])
      ])],
      fuss: [
        el('button', { 'class': 'knopf', text: t('csv.nein'), onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--gefahr-voll', text: t('csv.ja'),
          onclick: function () {
            try {
              herunterladen(V.exportCsv(Z.daten), 'text/csv;charset=utf-8', sauberName() + '_KLARTEXT.csv');
              zuruf(t('csv.fertig'), true);
            } catch (e) { zuruf(t('sp.downloadVerweigert'), true); }
            vorhangZu();
          }
        })
      ]
    }), false);
  }

  /* ------------------------------------------------- Verknüpfen */

  function symboleEinsetzen() {
    Array.prototype.forEach.call(document.querySelectorAll('.marke__logo'), function (n) { n.innerHTML = LOGO; });
    $('b-nav').replaceChildren(zeichen('menue'));
    $('b-sperren').replaceChildren(zeichen('schloss'));
    $('b-menue').replaceChildren(zeichen('mehr'));
    document.querySelector('.suche__symbol').replaceChildren(zeichen('lupe'));
    document.querySelector('#s-start .ablage__symbol').replaceChildren(zeichen('import'));
    document.querySelector('.plus__symbol').replaceChildren(zeichen('plus'));
    $('start-version').textContent = 'v' + APP_VERSION;
  }

  function verknuepfen() {
    $('b-datei').addEventListener('change', function (e) { dateiLesen(e.target.files[0]); e.target.value = ''; });
    $('ablage').addEventListener('click', function () { dateiWaehlen(); });
    $('ablage').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dateiWaehlen(); } });
    $('b-neuer-tresor').addEventListener('click', aufbauenNeu);

    ['dragenter', 'dragover'].forEach(function (typ) {
      document.addEventListener(typ, function (e) {
        if (!$('s-start').classList.contains('versteckt')) { e.preventDefault(); $('ablage').classList.add('ablage--bereit'); }
      });
    });
    ['dragleave', 'drop'].forEach(function (typ) {
      document.addEventListener(typ, function (e) {
        if ($('s-start').classList.contains('versteckt')) { return; }
        e.preventDefault(); $('ablage').classList.remove('ablage--bereit');
        if (typ === 'drop' && e.dataTransfer && e.dataTransfer.files[0]) {
          dateiLesen(e.dataTransfer.files[0]);   // per Ziehen gibt es kein Handle
        }
      });
    });

    $('b-speichern').addEventListener('click', function () { speichern(); });
    $('b-menue').addEventListener('click', menueZeigen);
    $('b-nav').addEventListener('click', function () { if ($('seite').classList.contains('seite--offen')) { navZu(); } else { navAuf(); } });
    $('nav-schleier').addEventListener('click', navZu);
    $('b-sperren').addEventListener('click', function () {
      if (Z.schmutzig && !window.confirm(t('sperre.verwerfen'))) { return; }
      sperren();
    });
    $('b-neu-eintrag').addEventListener('click', function () { blattBearbeiten(null); });
    $('suche').addEventListener('input', function (e) { Z.suche = e.target.value; bannerZeichnen(); inhaltZeichnen(); });
    $('suche').addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && Z.suche) { e.stopPropagation(); Z.suche = ''; e.target.value = ''; zeichnen(); }
      if (e.key === 'Enter') {
        var erste = document.querySelector('#gitter .karte');
        if (erste) { e.preventDefault(); erste.focus(); }
      }
    });

    document.addEventListener('keydown', function (e) {
      var offen = !!$('vorhang-halter').firstChild;
      if (e.key === 'Escape') {
        if (offen) {
          var oben = $('vorhang-halter').lastChild;
          if (oben && oben._schliessen) { oben._schliessen(); } else { vorhangZu(); }
          return;
        }
        if ($('seite').classList.contains('seite--offen')) { navZu(); return; }
        if (Z.auswahl) { auswahlUmschalten(false); return; }
      }
      if (!Z.daten) { return; }
      var tippt = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(document.activeElement.tagName) >= 0;
      if ((e.key === 'k' || e.key === 'f') && (e.ctrlKey || e.metaKey) && !offen) {
        e.preventDefault(); var s = $('suche'); if (s) { s.focus(); s.select(); }
      }
      if (e.key === '/' && !offen && !tippt) { e.preventDefault(); $('suche').focus(); }
      if (e.key === 'l' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sperren(); }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); speichern(); }
    });

    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (typ) {
      document.addEventListener(typ, function () { if (Z.daten && !$('vorhang-halter').firstChild) { ruheAnstossen(); } }, { passive: true });
    });

    window.addEventListener('beforeunload', function (e) {
      if (Z.schmutzig) { e.preventDefault(); e.returnValue = ''; return ''; }
    });

    /* Wandert der Tab in den Hintergrund, wird schneller zugesperrt: ein
     * offener Tresor auf einem Bildschirm, den gerade jemand anderes sieht,
     * soll nicht ewig offen bleiben. Nur wenn nichts Ungespeichertes wartet,
     * sonst ginge die Arbeit verloren. */
    document.addEventListener('visibilitychange', function () {
      if (!Z.daten) { return; }
      if (document.hidden) {
        clearTimeout(Z.verstecktUhr);
        if (!Z.schmutzig) {
          Z.verstecktUhr = setTimeout(function () { if (document.hidden && Z.daten && !Z.schmutzig) { sperren(); } }, VERSTECKT_SPERRE_MS);
        }
      } else {
        clearTimeout(Z.verstecktUhr);
        ruheAnstossen();
      }
    });
  }

  function sortierUmschalten() {
    var i = SORT_FOLGE.indexOf(Z.sortierung);
    Z.sortierung = SORT_FOLGE[(i + 1) % SORT_FOLGE.length];
    inhaltZeichnen();
    zuruf(t('kopf.sortierung', { name: t(SORT_TEXT[Z.sortierung]) }));
    var b = $('b-sortieren'); if (b) { b.focus(); }
  }

  /* ------------------------------------------------- Start */

  function starten() {
    /* Vor dem Aufsperren gibt es keine gespeicherte Sprache; der Browser
     * entscheidet. Deutsch bleibt der Standard. */
    var nav = (navigator.language || 'de').toLowerCase();
    I18N.setLang(nav.indexOf('de') === 0 ? 'de' : (nav.indexOf('en') === 0 ? 'en' : 'de'));
    statischUebersetzen();
    symboleEinsetzen();

    if (!window.sodium) { fehlstart(t('laden.sodiumFehlt')); return; }
    window.sodium.ready.then(function () {
      if (typeof window.sodium.crypto_pwhash !== 'function') {
        fehlstart(t('laden.ohneArgon'));
        return;
      }
      V.init(window.sodium);
      Seal.init(window.sodium);
      verknuepfen();
      startSpracheZeichnen();
      $('laedt').classList.add('versteckt');
      zeige('s-start');
    }).catch(function (e) {
      fehlstart(t('laden.sodiumKaputt', { text: (e && e.message ? e.message : e) }));
    });
  }

  function fehlstart(text) {
    var l = $('laedt');
    l.classList.remove('versteckt');
    leeren(l);
    l.appendChild(el('div', { 'class': 'tafel tafel--schmal' }, [
      el('p', { 'class': 'etikett', text: t('laden.fehlstart') }),
      el('div', { 'class': 'warnung', text: text })
    ]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', starten);
  } else { starten(); }

  /* Nur für die Testreihe. Im Browser stört es niemanden. */
  window.PPApp = {
    version: APP_VERSION,
    zustand: Z,
    kann: { ueberschreiben: KANN_UEBERSCHREIBEN, oeffnenMitHandle: KANN_OEFFNEN_MIT_HANDLE },
    speichern: speichern,
    sperren: sperren,
    zeichnen: zeichnen,
    geheZu: geheZu,
    blattBearbeiten: blattBearbeiten,
    blattZeigen: blattZeigen,
    reiterVerwalten: reiterVerwalten,
    kassensturzZeigen: kassensturzZeigen,
    importZeigen: importZeigen,
    masterAendern: masterAendern,
    menueZeigen: menueZeigen,
    notfallzettelZeigen: notfallzettelZeigen,
    notfallDrucken: notfallDrucken,
    einstellungenZeigen: einstellungenZeigen,
    generatorZeigen: generatorZeigen,
    ueberZeigen: ueberZeigen,
    loeschenFragen: loeschenFragen,
    appAufbauen: appAufbauen,
    dateiLesen: dateiLesen,
    auswahlUmschalten: auswahlUmschalten,
    sicherungHerunterladen: sicherungHerunterladen,
    lesezeichenExportieren: lesezeichenExportieren,
    spracheSetzen: spracheSetzen
  };
}());
