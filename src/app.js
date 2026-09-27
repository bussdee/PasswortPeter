/* PasswortPeter – Anwendung
 *
 * Läuft als klassisches <script> unter file://. Keine Module, kein Netz,
 * kein Browser-Speicher. Was hier im Arbeitsspeicher liegt, ist alles.
 *
 * Zwei Regeln, die im ganzen Code gelten:
 *   1. Fremder Text geht nie über innerHTML. Nur textContent.
 *   2. Adressen gehen nur durch PPVault.safeUrl in ein href.
 */
(function () {
  'use strict';

  var V = window.PPVault;
  var Seal = window.PPSeal;

  var SPERRE_STANDARD_MS = 5 * 60 * 1000;
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
    kategorie: null,
    nurFavoriten: false,
    imPapierkorb: false,
    sortierung: 'name',
    ruheUhr: null,
    verstecktUhr: null,
    countdownUhr: null,
    ablageUhr: null,
    zurufUhr: null
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

  var ZEICHEN = {
    welt: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    schluessel: '<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M17 5l2 2M14 8l2 2"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    stern: '<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6L12 17l-5.4 2.8 1-6L3.2 9.4l6.1-.9z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    stift: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    auge: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.8"/>',
    wuerfel: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>',
    zurueck: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>',
    muell: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    schild: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
    kette: '<path d="M9 12a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h-1"/><path d="M15 12a3 3 0 0 1-3 3H9a3 3 0 0 1 0-6h1"/>',
    feder: '<path d="M20 4C13 4 8 8 6 15l-2 5 5-2c7-2 11-7 11-14z"/><path d="M6 20L14 12"/>'
  };

  function zeichen(name, gefuellt) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', gefuellt ? 'currentColor' : 'none');
    s.setAttribute('stroke', gefuellt ? 'none' : 'currentColor');
    s.setAttribute('stroke-width', '1.7');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ZEICHEN[name] || '';
    return s;
  }

  function siegel(klasse, seed, label) {
    return el('div', { 'class': klasse, html: Seal.svg(seed, label) });
  }

  function zuruf(text, warn) {
    var halter = $('zuruf-halter');
    leeren(halter);
    clearTimeout(Z.zurufUhr);
    halter.appendChild(el('div', {
      'class': 'zuruf' + (warn ? ' zuruf--warn' : ''),
      role: 'status', 'aria-live': 'polite', text: text
    }));
    Z.zurufUhr = setTimeout(function () { leeren(halter); }, 2600);
  }

  /* Wie zuruf, aber mit einem Zurück-Knopf. Für Löschungen: ein Griff genügt,
   * um sie sofort rückgängig zu machen, ohne den Umweg über den Papierkorb. */
  function zurufMitZurueck(text, zurueck) {
    var halter = $('zuruf-halter');
    leeren(halter);
    clearTimeout(Z.zurufUhr);
    var knopf = el('button', {
      'class': 'zuruf__zurueck', text: 'Zurückholen',
      onclick: function () { leeren(halter); zurueck(); }
    });
    halter.appendChild(el('div', { 'class': 'zuruf zuruf--tat', role: 'status' }, [
      el('span', { text: text }), knopf
    ]));
    Z.zurufUhr = setTimeout(function () { leeren(halter); }, 6000);
  }

  function zeige(id) {
    ['s-start', 's-neu', 's-auf', 's-app'].forEach(function (s) {
      $(s).classList.toggle('versteckt', s !== id);
    });
  }

  /* ------------------------------------------------- Zwischenablage */

  function kopiere(text, was) {
    var fertig = function () {
      zuruf(was + ' kopiert · leert sich in ' + (ABLAGE_LEEREN_MS / 1000) + ' s');
      clearTimeout(Z.ablageUhr);
      Z.ablageUhr = setTimeout(leereAblage, ABLAGE_LEEREN_MS);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(fertig, function () {
        if (altKopieren(text)) { fertig(); } else { zuruf('Der Browser lässt das Kopieren nicht zu.', true); }
      });
    } else if (altKopieren(text)) { fertig(); }
    else { zuruf('Der Browser lässt das Kopieren nicht zu.', true); }
  }

  /* Weg für Browser, die navigator.clipboard unter file:// verweigern. */
  function altKopieren(text) {
    try {
      var t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      t.setSelectionRange(0, t.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(t);
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
    var blatt = el('div', { 'class': 'blatt', role: 'alertdialog', 'aria-modal': 'true', style: 'max-width:400px' }, [
      el('div', { 'class': 'blatt__kopf' }, [el('h2', { 'class': 'blatt__titel', text: 'Der Tresor sperrt zu' })]),
      el('div', { 'class': 'blatt__leib' }, [
        el('p', { style: 'margin:0 0 .6rem' }, ['Es gibt ungespeicherte Änderungen. Wenn du nichts tust, sind sie in ', zahl, ' Sekunden weg.']),
        el('p', { style: 'margin:0;font-size:.8rem;color:var(--stahl)', text: 'Ohne Server gibt es keinen Zwischenspeicher. Was nicht in der Datei steht, existiert nicht.' })
      ]),
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', {
          'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Weiterarbeiten',
          onclick: function () { vorhangZu(); ruheAnstossen(); }
        }),
        el('button', {
          'class': 'knopf knopf--voll', text: 'Speichern und sperren',
          onclick: function () { vorhangZu(); speichern().then(function (ok) { if (ok) { sperren(); } }); }
        })
      ])
    ]);
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
    Z.kategorie = null;
    Z.nurFavoriten = false;
    Z.imPapierkorb = false;
    Z.sortierung = 'name';
    vorhangZu();
    zeige('s-start');
    $('start-fehler').classList.add('versteckt');
    zuruf('Zugesperrt');
  }

  function schmutzig(ja) {
    Z.schmutzig = ja;
    var p = $('leiste-punkt');
    if (p) {
      p.classList.toggle('leiste__punkt--rein', !ja);
      p.setAttribute('title', ja ? 'Ungespeicherte Änderungen' : 'Alles gespeichert');
    }
    var b = $('b-speichern');
    if (b) { b.textContent = ja ? 'Speichern *' : 'Speichern'; }
  }

  /* ------------------------------------------------- Datei einlesen */

  function dateiLesen(datei, handle) {
    if (!datei) { return; }
    if (datei.size > 40 * 1024 * 1024) {
      startFehler('Die Datei ist über 40 MB groß. Das ist kein Tresor.');
      return;
    }
    var leser = new FileReader();
    leser.onerror = function () { startFehler('Die Datei ließ sich nicht lesen.'); };
    leser.onload = function () {
      var bytes = new Uint8Array(leser.result);
      var kopf;
      try { kopf = V.readHeader(bytes); }
      catch (e) { startFehler(e.message); return; }
      Z.rohdatei = bytes;
      Z.dateiname = datei.name.replace(/\.peter$/i, '') || 'Tresor';
      Z.dateiHandle = handle || null;   // nur der Dateiwähler liefert ein Handle
      Z.kdf = { ops: kopf.ops, memKiB: kopf.memKiB };
      aufbauenAufschliessen();
    };
    leser.readAsArrayBuffer(datei);
  }

  /* Öffnen über den Dateiwähler des Browsers. Nur dieser Weg liefert ein
   * Handle, mit dem später dieselbe Datei überschrieben werden kann. Kann der
   * Browser das nicht, wird der klassische Dateidialog benutzt. */
  async function dateiWaehlen() {
    if (KANN_OEFFNEN_MIT_HANDLE) {
      try {
        var ergebnis = await window.showOpenFilePicker({
          types: [{ description: 'PasswortPeter-Tresor', accept: { 'application/octet-stream': ['.peter'] } }],
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

  /* ------------------------------------------------- Bildschirm: Aufsperren */

  function aufbauenAufschliessen() {
    var halter = $('auf-mitte');
    leeren(halter);

    var fehler = el('div', { 'class': 'warnung versteckt', role: 'alert' });
    var eingabe = el('input', {
      'class': 'dunkel-eingabe', type: 'password', id: 'auf-pw',
      autocomplete: 'current-password', placeholder: 'Master-Passwort'
    });
    var riegel = el('div', { 'class': 'riegel versteckt' }, [el('div', { 'class': 'riegel__lauf' })]);
    var knopf = el('button', { 'class': 'knopf knopf--voll', text: 'Aufsperren' });

    var laeuft = false;
    function versuchen() {
      if (laeuft) { return; }
      var pw = eingabe.value;
      if (!pw) { return; }
      laeuft = true;
      fehler.classList.add('versteckt');
      riegel.classList.remove('versteckt');
      knopf.disabled = true; eingabe.disabled = true;
      knopf.textContent = 'Rechnet …';

      /* Zwei Bilder Pause, damit der Riegel wirklich zu sehen ist, bevor
       * Argon2id den Hauptstrang für ein bis vier Sekunden blockiert. */
      setTimeout(function () {
        var ergebnis;
        try {
          ergebnis = V.decrypt(Z.rohdatei, pw);
        } catch (e) {
          laeuft = false;
          riegel.classList.add('versteckt');
          knopf.disabled = false; eingabe.disabled = false;
          knopf.textContent = 'Aufsperren';
          fehler.textContent = e.message;
          fehler.classList.remove('versteckt');
          eingabe.value = '';
          eingabe.focus();
          return;
        }
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

    halter.appendChild(siegel('kasten__siegel', Z.dateiname, Z.dateiname));
    halter.appendChild(el('h1', { 'class': 'kasten__name', text: Z.dateiname }));
    halter.appendChild(el('p', { 'class': 'kasten__zeile', text: 'Argon2id, ' + Math.round(Z.kdf.memKiB / 1024) + ' MiB, ' + Z.kdf.ops + ' Durchgänge' }));
    halter.appendChild(el('div', { 'class': 'feld' }, [eingabe]));
    halter.appendChild(riegel);
    halter.appendChild(el('div', { 'class': 'knopf-reihe' }, [
      knopf,
      el('button', { 'class': 'knopf knopf--text', text: 'Andere Datei wählen', onclick: function () { Z.rohdatei = null; zeige('s-start'); } })
    ]));
    halter.appendChild(fehler);

    zeige('s-auf');
    setTimeout(function () { eingabe.focus(); }, 30);
  }

  /* ------------------------------------------------- Bildschirm: Neu */

  function aufbauenNeu() {
    var halter = $('neu-mitte');
    leeren(halter);

    var name = el('input', { 'class': 'dunkel-eingabe', type: 'text', placeholder: 'Familie', maxlength: '60' });
    var pw1 = el('input', { 'class': 'dunkel-eingabe', type: 'password', autocomplete: 'new-password', placeholder: 'Mindestens 12 Zeichen' });
    var pw2 = el('input', { 'class': 'dunkel-eingabe', type: 'password', autocomplete: 'new-password', placeholder: 'Noch einmal' });
    var fehler = el('div', { 'class': 'warnung versteckt', role: 'alert' });
    var riegel = el('div', { 'class': 'riegel versteckt' }, [el('div', { 'class': 'riegel__lauf' })]);
    var knopf = el('button', { 'class': 'knopf knopf--voll', text: 'Tresor anlegen' });

    var teile = [], i;
    for (i = 0; i < 4; i++) { teile.push(el('div', { 'class': 'staerke__teil' })); }
    var wort = el('span', { text: '–' });
    var bits = el('span', { text: '' });
    var staerke = el('div', { 'class': 'staerke staerke--dunkel' }, [
      el('div', { 'class': 'staerke__spur' }, teile),
      el('div', { 'class': 'staerke__wort' }, [wort, bits])
    ]);

    var FARBEN = ['var(--rot)', 'var(--rot)', 'var(--messing-hell)', 'var(--gruen)', 'var(--gruen)'];
    pw1.addEventListener('input', function () {
      var r = V.ratePassword(pw1.value);
      wort.textContent = pw1.value ? r.text : '–';
      bits.textContent = pw1.value ? r.bits + ' bit' : '';
      teile.forEach(function (t, idx) {
        var an = idx < r.stufe;
        t.classList.toggle('staerke__teil--an', an);
        t.style.setProperty('--f', FARBEN[r.stufe]);
      });
    });

    var laeuft = false;
    knopf.addEventListener('click', function () {
      if (laeuft) { return; }
      fehler.classList.add('versteckt');
      var n = name.value.trim();
      if (!n) { fehler.textContent = 'Der Tresor braucht einen Namen.'; fehler.classList.remove('versteckt'); return; }
      if (pw1.value.length < 12) { fehler.textContent = 'Das Master-Passwort braucht mindestens 12 Zeichen.'; fehler.classList.remove('versteckt'); return; }
      if (pw1.value !== pw2.value) { fehler.textContent = 'Die beiden Passwörter sind nicht gleich.'; fehler.classList.remove('versteckt'); return; }
      if (V.ratePassword(pw1.value).stufe < 2) {
        fehler.textContent = 'Dieses Passwort ist zu schwach. Es gibt keine Wiederherstellung, also ist es die einzige Sperre.';
        fehler.classList.remove('versteckt'); return;
      }

      laeuft = true;
      riegel.classList.remove('versteckt');
      knopf.disabled = true;
      knopf.textContent = 'Rechnet …';

      setTimeout(function () {
        Z.daten = V.emptyVault(n);
        Z.passwort = pw1.value;
        Z.kdf = geraeteKdf();
        Z.dateiname = n;
        Z.dateiHandle = null;
        Z.daten.categories.push(V.newCategory('Wichtig', 'messing'));
        pw1.value = ''; pw2.value = '';
        appAufbauen();
        schmutzig(true);
        speichern();
      }, 40);
    });

    halter.appendChild(el('p', { 'class': 'kasten__marke', text: 'Neuer Tresor' }));
    halter.appendChild(el('div', { 'class': 'feld' }, [el('label', { 'class': 'feld__name', text: 'Name des Tresors' }), name]));
    halter.appendChild(el('div', { 'class': 'feld' }, [el('label', { 'class': 'feld__name', text: 'Master-Passwort' }), pw1, staerke]));
    halter.appendChild(el('button', {
      'class': 'knopf knopf--text', style: 'width:auto;margin:-.4rem 0 .6rem',
      onclick: function () {
        var vorschlag = V.generatePassphrase({ words: 6 });
        pw1.value = vorschlag; pw2.value = vorschlag;
        pw1.type = 'text'; pw2.type = 'text';
        pw1.dispatchEvent(new Event('input'));
        zuruf('Merksatz vorgeschlagen · gut merkbar, ' + V.passphraseBits({ words: 6 }) + ' bit');
      }
    }, ['Merksatz vorschlagen (leicht zu merken)']));
    halter.appendChild(el('div', { 'class': 'feld' }, [el('label', { 'class': 'feld__name', text: 'Wiederholung' }), pw2]));
    halter.appendChild(el('div', { 'class': 'hinweis-dunkel' }, [
      el('strong', { text: 'Es gibt keine Wiederherstellung.' }),
      document.createTextNode(' Kein Zurücksetzen, keine Hintertür, keine Notfallfrage. Wer dieses Passwort vergisst, hat den Tresor verloren. Endgültig. Schreib es auf Papier und leg es dorthin, wo auch die Dokumente liegen.')
    ]));
    halter.appendChild(riegel);
    halter.appendChild(el('div', { 'class': 'knopf-reihe' }, [
      knopf,
      el('button', { 'class': 'knopf knopf--text', text: 'Zurück', onclick: function () { zeige('s-start'); } })
    ]));
    halter.appendChild(fehler);

    zeige('s-neu');
    setTimeout(function () { name.focus(); }, 30);
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
   * .peter-Datei, die immer wieder überschrieben wird. Genau das war der Wunsch.
   * Kann er es nicht (Firefox, fast alle Handys), dann lädt er wie bisher eine
   * neue Datei herunter. Beide Wege sind gleich sicher, der Unterschied ist
   * nur der Komfort.
   */

  function sauberName() {
    return (Z.daten.name || 'Tresor').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Tresor';
  }

  function baueBytes() {
    return V.encrypt(Z.daten, Z.passwort, Z.kdf);
  }

  async function speichern() {
    if (!Z.daten || !Z.passwort) { return false; }
    var bytes;
    try { bytes = baueBytes(); }
    catch (e) { zuruf('Speichern fehlgeschlagen: ' + e.message, true); return false; }

    /* Weg 1: in dieselbe Datei zurückschreiben. */
    if (Z.dateiHandle) {
      try {
        if (!(await handleSchreibbar(Z.dateiHandle))) {
          zuruf('Der Schreibzugriff wurde abgelehnt.', true);
          return false;
        }
        var w = await Z.dateiHandle.createWritable();
        await w.write(bytes);
        await w.close();
        schmutzig(false);
        zuruf('In die Datei gespeichert');
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
          types: [{ description: 'PasswortPeter-Tresor', accept: { 'application/octet-stream': ['.peter'] } }]
        });
        var w2 = await handle.createWritable();
        await w2.write(bytes);
        await w2.close();
        Z.dateiHandle = handle;
        Z.dateiname = handle.name.replace(/\.peter$/i, '') || Z.dateiname;
        schmutzig(false);
        modusZeigen();
        zuruf('Gespeichert. Ab jetzt wird diese Datei überschrieben.');
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') { return false; }   // Nutzer hat abgebrochen
        /* sonst weiter zum Download */
      }
    }

    /* Weg 2: Download. */
    try {
      var blob = new Blob([bytes], { type: 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: sauberName() + '.peter' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    } catch (e) {
      zuruf('Der Browser hat den Download verweigert.', true);
      return false;
    }
    schmutzig(false);
    zuruf(sauberName() + '.peter heruntergeladen');
    return true;
  }

  async function handleSchreibbar(handle) {
    if (!handle.queryPermission) { return true; }
    var opt = { mode: 'readwrite' };
    if ((await handle.queryPermission(opt)) === 'granted') { return true; }
    return (await handle.requestPermission(opt)) === 'granted';
  }

  /* Zeigt in der Leiste, ob gerade in eine feste Datei gespeichert wird oder
   * heruntergeladen. Das nimmt die Überraschung aus dem Speichern-Knopf. */
  function modusZeigen() {
    var b = $('b-speichern');
    if (!b) { return; }
    if (Z.dateiHandle) { b.setAttribute('title', 'Überschreibt: ' + Z.dateiHandle.name); }
    else if (KANN_UEBERSCHREIBEN) { b.setAttribute('title', 'Beim ersten Speichern fragt der Browser nach dem Ort.'); }
    else { b.setAttribute('title', 'Lädt eine neue Datei herunter.'); }
  }

  /* ------------------------------------------------- Die Kartei */

  function appAufbauen() {
    zeige('s-app');
    $('leiste-siegel-halter').replaceChildren(siegel('leiste__siegel', Z.daten.name, Z.daten.name));
    $('leiste-name').textContent = Z.daten.name;
    schmutzig(Z.schmutzig);
    modusZeigen();
    zeichnen();
    ruheAnstossen();
  }

  function zeichnen() { reiterZeichnen(); karteiZeichnen(); }

  function reiterZeichnen() {
    var nav = $('reiter');
    leeren(nav);

    var lebend = Z.daten.items.filter(function (it) { return !it.deletedAt; });
    var zaehler = Object.create(null);
    lebend.forEach(function (it) { if (it.cat) { zaehler[it.cat] = (zaehler[it.cat] || 0) + 1; } });
    var ohne = lebend.filter(function (it) { return !it.cat; }).length;
    var favs = lebend.filter(function (it) { return it.fav; }).length;
    var muell = V.trashList(Z.daten).length;

    function knopf(text, farbe, anzahl, aktiv, klick) {
      return el('button', {
        'class': 'reiter__eintrag' + (aktiv ? ' reiter__eintrag--aktiv' : ''),
        stil: farbe ? '--f:' + farbe : '',
        onclick: klick
      }, [
        el('span', { 'class': 'reiter__farbe' }),
        el('span', { 'class': 'reiter__text', text: text }),
        el('span', { 'class': 'reiter__zahl', text: String(anzahl) })
      ]);
    }

    var alle = el('div', { 'class': 'reiter__gruppe' }, [
      el('p', { 'class': 'reiter__kopf', text: 'Kartei' }),
      knopf('Alle', 'var(--stahl)', lebend.length, !Z.kategorie && !Z.nurFavoriten && !Z.imPapierkorb, function () {
        Z.kategorie = null; Z.nurFavoriten = false; Z.imPapierkorb = false; zeichnen();
      }),
      knopf('Favoriten', 'var(--messing-hell)', favs, Z.nurFavoriten && !Z.imPapierkorb, function () {
        Z.kategorie = null; Z.nurFavoriten = true; Z.imPapierkorb = false; zeichnen();
      })
    ]);
    nav.appendChild(alle);

    var gruppe = el('div', { 'class': 'reiter__gruppe' }, [el('p', { 'class': 'reiter__kopf', text: 'Reiter' })]);
    Z.daten.categories.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (c) {
      gruppe.appendChild(knopf(c.name || 'Ohne Namen', 'var(--kat-' + c.color + ')', zaehler[c.id] || 0, Z.kategorie === c.id && !Z.imPapierkorb, function () {
        Z.kategorie = c.id; Z.nurFavoriten = false; Z.imPapierkorb = false; zeichnen();
      }));
    });
    if (ohne > 0) {
      gruppe.appendChild(knopf('Ohne Reiter', 'var(--linie)', ohne, Z.kategorie === '__ohne' && !Z.imPapierkorb, function () {
        Z.kategorie = '__ohne'; Z.nurFavoriten = false; Z.imPapierkorb = false; zeichnen();
      }));
    }
    gruppe.appendChild(el('button', {
      'class': 'reiter__eintrag', style: 'color:var(--stahl)',
      onclick: reiterVerwalten
    }, [
      el('span', { 'class': 'reiter__farbe', style: 'background:transparent' }),
      el('span', { 'class': 'reiter__text', text: 'Reiter verwalten …' })
    ]));
    nav.appendChild(gruppe);

    var werkzeug = el('div', { 'class': 'reiter__gruppe' }, [el('p', { 'class': 'reiter__kopf', text: 'Werkzeug' })]);
    werkzeug.appendChild(el('button', {
      'class': 'reiter__eintrag', 'data-rolle': 'kassensturz', onclick: kassensturzZeigen
    }, [
      el('span', { 'class': 'reiter__farbe', style: 'background:var(--gruen)' }),
      el('span', { 'class': 'reiter__text', text: 'Kassensturz' }),
      kassensturzMarke()
    ]));
    werkzeug.appendChild(el('button', {
      'class': 'reiter__eintrag', onclick: importZeigen
    }, [
      el('span', { 'class': 'reiter__farbe', style: 'background:transparent' }),
      el('span', { 'class': 'reiter__text', text: 'Import …' })
    ]));
    if (muell > 0) {
      werkzeug.appendChild(knopf('Papierkorb', 'var(--rot)', muell, Z.imPapierkorb, function () {
        Z.imPapierkorb = true; Z.kategorie = null; Z.nurFavoriten = false; zeichnen();
      }));
    }
    nav.appendChild(werkzeug);
  }

  /* Ein roter Punkt am Kassensturz, wenn es etwas zu tun gibt. */
  function kassensturzMarke() {
    var a = V.audit(Z.daten);
    var wund = a.doppelt.length + a.schwach.length;
    if (wund === 0) { return el('span', { 'class': 'reiter__zahl', style: 'color:var(--gruen)', text: '✓' }); }
    return el('span', { 'class': 'muellmarke', text: String(wund) });
  }

  function karteiZeichnen() {
    var gitter = $('gitter');
    leeren(gitter);

    if (Z.imPapierkorb) { papierkorbZeichnen(gitter); return; }

    var kat = Z.kategorie;
    var liste;
    if (kat === '__ohne') {
      liste = V.search(Z.daten, Z.suche, null, false, Z.sortierung).filter(function (it) { return !it.cat; });
    } else {
      liste = V.search(Z.daten, Z.suche, kat, Z.nurFavoriten, Z.sortierung);
    }

    if (liste.length === 0) {
      var leerImTresor = V.liveCount(Z.daten) === 0;
      gitter.appendChild(el('div', { 'class': 'leer', style: 'grid-column:1/-1' }, [
        el('strong', { text: leerImTresor ? 'Der Karteikasten ist leer' : 'Nichts gefunden' }),
        document.createTextNode(leerImTresor
          ? 'Leg unten rechts die erste Karte an, oder hol dir über Import deine Lesezeichen herein. Eine Karte ohne Benutzer und Passwort ist einfach ein Lesezeichen.'
          : 'Andere Suche oder anderer Reiter.')
      ]));
      return;
    }

    liste.forEach(function (it) { gitter.appendChild(karteBauen(it)); });
  }

  function papierkorbZeichnen(gitter) {
    var liste = V.trashList(Z.daten).filter(function (it) {
      if (!Z.suche) { return true; }
      return (it.title + ' ' + it.url + ' ' + it.user).toLowerCase().indexOf(Z.suche.toLowerCase()) >= 0;
    });

    var kopf = el('div', { 'class': 'papierkorb-kopf', style: 'grid-column:1/-1' }, [
      el('span', { text: liste.length + (liste.length === 1 ? ' Karte im Papierkorb' : ' Karten im Papierkorb') }),
      liste.length > 0 ? el('button', {
        'class': 'knopf--text', style: 'color:var(--rot)', text: 'Papierkorb endgültig leeren',
        onclick: papierkorbLeerenFragen
      }) : null
    ]);
    gitter.appendChild(kopf);

    if (liste.length === 0) {
      gitter.appendChild(el('div', { 'class': 'leer', style: 'grid-column:1/-1' }, [
        el('strong', { text: 'Papierkorb ist leer' }),
        document.createTextNode('Gelöschte Karten landen hier und lassen sich zurückholen, bis der Papierkorb geleert wird.')
      ]));
      return;
    }

    liste.forEach(function (it) {
      var host = V.hostOf(it.url);
      var karte = el('div', { 'class': 'karte karte--muell' }, [
        siegel('karte__siegel', host || it.title || '?', it.title || host),
        el('div', { 'class': 'karte__text' }, [
          el('h3', { 'class': 'karte__titel', text: it.title || host || 'Ohne Titel' }),
          el('p', { 'class': 'karte__unten', text: 'gelöscht ' + kurzDatum(it.deletedAt) })
        ]),
        el('div', { 'class': 'karte__tun' }, [
          el('button', {
            'class': 'tun', title: 'Zurückholen', 'aria-label': 'Zurückholen: ' + (it.title || host),
            onclick: function () { it.deletedAt = null; it.updatedAt = new Date().toISOString(); schmutzig(true); zeichnen(); zuruf('Zurückgeholt'); }
          }, [zeichen('zurueck')]),
          el('button', {
            'class': 'tun', title: 'Endgültig löschen', 'aria-label': 'Endgültig löschen',
            onclick: function () {
              Z.daten.items = Z.daten.items.filter(function (x) { return x.id !== it.id; });
              schmutzig(true); zeichnen(); zuruf('Endgültig gelöscht');
            }
          }, [zeichen('muell')])
        ])
      ]);
      gitter.appendChild(karte);
    });
  }

  function kurzDatum(iso) {
    if (!iso) { return ''; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function papierkorbLeerenFragen() {
    var anzahl = V.trashList(Z.daten).length;
    var blatt = el('div', { 'class': 'blatt', role: 'alertdialog', 'aria-modal': 'true', style: 'max-width:400px' }, [
      el('div', { 'class': 'blatt__kopf' }, [el('h2', { 'class': 'blatt__titel', text: 'Papierkorb leeren?' })]),
      el('div', { 'class': 'blatt__leib' }, [
        el('p', { style: 'margin:0', text: anzahl + (anzahl === 1 ? ' Karte wird' : ' Karten werden') + ' unwiderruflich entfernt. Das lässt sich nicht zurückholen.' })
      ]),
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Behalten', onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--voll', style: 'background:var(--rot);color:#fff', text: 'Leeren',
          onclick: function () {
            Z.daten.items = Z.daten.items.filter(function (it) { return !it.deletedAt; });
            schmutzig(true); vorhangZu(); zeichnen(); zuruf('Papierkorb geleert');
          }
        })
      ])
    ]);
    vorhangAuf(blatt, false);
  }

  function karteBauen(it) {
    var cat = it.cat ? Z.daten.categories.filter(function (c) { return c.id === it.cat; })[0] : null;
    var host = V.hostOf(it.url);
    var unten = [];
    if (host) { unten.push(host); }
    if (it.user) { unten.push(it.user); }

    var tun = el('div', { 'class': 'karte__tun' });

    var href = V.safeUrl(it.url);
    if (href) {
      tun.appendChild(el('button', {
        'class': 'tun', title: 'Website öffnen', 'aria-label': 'Website öffnen: ' + (it.title || host),
        onclick: function (e) { e.stopPropagation(); benutzt(it); oeffneSeite(href); }
      }, [zeichen('welt')]));
    }
    if (it.user) {
      tun.appendChild(el('button', {
        'class': 'tun', title: 'Benutzer kopieren', 'aria-label': 'Benutzer kopieren: ' + (it.title || host),
        onclick: function (e) { e.stopPropagation(); benutzt(it); kopiere(it.user, 'Benutzer'); }
      }, [zeichen('person')]));
    }
    if (it.pass) {
      tun.appendChild(el('button', {
        'class': 'tun', title: 'Passwort kopieren', 'aria-label': 'Passwort kopieren: ' + (it.title || host),
        onclick: function (e) { e.stopPropagation(); benutzt(it); kopiere(it.pass, 'Passwort'); }
      }, [zeichen('schluessel')]));
    }
    tun.appendChild(el('button', {
      'class': 'tun' + (it.fav ? ' stern' : ''), title: it.fav ? 'Favorit entfernen' : 'Als Favorit merken',
      'aria-label': it.fav ? 'Favorit entfernen' : 'Als Favorit merken',
      onclick: function (e) {
        e.stopPropagation();
        it.fav = !it.fav; it.updatedAt = new Date().toISOString();
        schmutzig(true); zeichnen();
      }
    }, [zeichen('stern', it.fav)]));

    var karte = el('div', {
      'class': 'karte', role: 'button', tabindex: '0',
      stil: cat ? '--f:var(--kat-' + cat.color + ')' : '',
      onclick: function () { blattZeigen(it); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); blattZeigen(it); } }
    }, [
      siegel('karte__siegel', host || it.title || '?', it.title || host),
      el('div', { 'class': 'karte__text' }, [
        el('h3', { 'class': 'karte__titel', text: it.title || host || 'Ohne Titel' }),
        el('p', { 'class': 'karte__unten', text: unten.join(' · ') || (V.isBookmark(it) ? 'Lesezeichen' : '') })
      ]),
      tun
    ]);
    return karte;
  }

  /* Merkt sich, wann eine Karte zuletzt benutzt wurde, für die Sortierung.
   * Das gilt nicht als inhaltliche Änderung, es löst also kein "ungespeichert"
   * aus, sonst wäre nach jedem Öffnen einer Website der Stern gesetzt. */
  function benutzt(it) {
    it.usedAt = new Date().toISOString();
  }

  function oeffneSeite(href) {
    var w = window.open(href, '_blank', 'noopener,noreferrer');
    if (w) { w.opener = null; }
    else { zuruf('Der Browser hat das Fenster blockiert.', true); }
  }

  /* ------------------------------------------------- Vorhang */

  var _fokusVorher = null;
  function vorhangAuf(blatt, mitKlickZu) {
    var halter = $('vorhang-halter');
    leeren(halter);
    _fokusVorher = document.activeElement;
    var vorhang = el('div', {
      'class': 'vorhang',
      onclick: function (e) { if (mitKlickZu !== false && e.target === vorhang) { vorhangZu(); } }
    }, [blatt]);
    halter.appendChild(vorhang);
    document.body.style.overflow = 'hidden';

    /* Tab bleibt innerhalb des Dialogs gefangen. Sonst wandert der Fokus hinter
     * den Vorhang auf die Kartei, die dort verdeckt liegt. */
    vorhang.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') { return; }
      var fokusbar = blatt.querySelectorAll('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])');
      fokusbar = Array.prototype.filter.call(fokusbar, function (n) { return !n.disabled && n.offsetParent !== null; });
      if (fokusbar.length === 0) { return; }
      var erst = fokusbar[0], letzt = fokusbar[fokusbar.length - 1];
      if (e.shiftKey && document.activeElement === erst) { e.preventDefault(); letzt.focus(); }
      else if (!e.shiftKey && document.activeElement === letzt) { e.preventDefault(); erst.focus(); }
    });
  }

  function vorhangZu() {
    leeren($('vorhang-halter'));
    document.body.style.overflow = '';
    clearInterval(Z.countdownUhr);
    if (_fokusVorher && _fokusVorher.focus) { try { _fokusVorher.focus(); } catch (e) { /* egal */ } }
    _fokusVorher = null;
  }

  /* ------------------------------------------------- Blatt: Karte ansehen */

  function blattZeigen(it) {
    var host = V.hostOf(it.url);
    var href = V.safeUrl(it.url);
    var leib = el('div', { 'class': 'blatt__leib' });

    if (it.url) {
      leib.appendChild(el('div', { 'class': 'hell-feld' }, [
        el('label', { 'class': 'hell-feld__name', text: 'Adresse' }),
        el('div', { 'class': 'wert' }, [
          el('span', { 'class': 'wert__text', text: it.url }),
          href ? el('button', { 'class': 'tun', title: 'Website öffnen', onclick: function () { oeffneSeite(href); } }, [zeichen('welt')]) : null,
          el('button', { 'class': 'tun', title: 'Adresse kopieren', onclick: function () { kopiere(it.url, 'Adresse'); } }, [zeichen('person')])
        ])
      ]));
      if (!href) {
        leib.appendChild(el('p', { style: 'margin:-.5rem 0 .9rem;font-size:.75rem;color:var(--rot)', text: 'Diese Adresse lässt sich nicht öffnen. Erlaubt sind nur http und https.' }));
      }
    }

    if (it.user) {
      leib.appendChild(el('div', { 'class': 'hell-feld' }, [
        el('label', { 'class': 'hell-feld__name', text: 'Benutzer' }),
        el('div', { 'class': 'wert' }, [
          el('span', { 'class': 'wert__text', text: it.user }),
          el('button', { 'class': 'tun', title: 'Benutzer kopieren', onclick: function () { kopiere(it.user, 'Benutzer'); } }, [zeichen('person')])
        ])
      ]));
    }

    if (it.pass) {
      var sichtbar = false;
      var punkte = el('span', { 'class': 'wert__text wert__punkte', text: '••••••••••••' });
      var augeKnopf = el('button', { 'class': 'tun', title: 'Passwort zeigen' }, [zeichen('auge')]);
      augeKnopf.addEventListener('click', function () {
        sichtbar = !sichtbar;
        punkte.textContent = sichtbar ? it.pass : '••••••••••••';
        punkte.classList.toggle('wert__punkte', !sichtbar);
        augeKnopf.setAttribute('title', sichtbar ? 'Passwort verbergen' : 'Passwort zeigen');
      });
      var r = V.ratePassword(it.pass);
      leib.appendChild(el('div', { 'class': 'hell-feld' }, [
        el('label', { 'class': 'hell-feld__name', text: 'Passwort · ' + r.text + ' · ' + r.bits + ' bit' }),
        el('div', { 'class': 'wert' }, [
          punkte, augeKnopf,
          el('button', { 'class': 'tun', title: 'Passwort kopieren', onclick: function () { kopiere(it.pass, 'Passwort'); } }, [zeichen('schluessel')])
        ])
      ]));
    }

    if (it.note) {
      leib.appendChild(el('div', { 'class': 'hell-feld' }, [
        el('label', { 'class': 'hell-feld__name', text: 'Notiz' }),
        el('div', { 'class': 'wert' }, [el('span', { 'class': 'wert__text', style: 'font-family:var(--ui);white-space:pre-wrap', text: it.note })])
      ]));
    }

    if (V.isBookmark(it)) {
      leib.appendChild(el('p', { style: 'margin:.2rem 0 0;font-size:.78rem;color:var(--stahl)', text: 'Reines Lesezeichen. Kein Benutzer, kein Passwort hinterlegt.' }));
    }

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true', 'aria-label': it.title || host || 'Karte' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        siegel('blatt__siegel', host || it.title || '?', it.title || host),
        el('h2', { 'class': 'blatt__titel', text: it.title || host || 'Ohne Titel' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      leib,
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Bearbeiten', onclick: function () { blattBearbeiten(it); } }),
        href ? el('button', { 'class': 'knopf knopf--voll', text: 'Website öffnen', onclick: function () { oeffneSeite(href); } }) : null
      ])
    ]);
    vorhangAuf(blatt);
  }

  /* ------------------------------------------------- Blatt: Karte bearbeiten */

  function blattBearbeiten(vorhanden) {
    var neu = !vorhanden;
    var it = vorhanden || V.newItem({ cat: (Z.kategorie && Z.kategorie !== '__ohne') ? Z.kategorie : null });

    var fTitel = el('input', { 'class': 'hell-eingabe', type: 'text', value: it.title, maxlength: '120', style: 'font-family:var(--ui)' });
    var fUrl = el('input', { 'class': 'hell-eingabe', type: 'text', value: it.url, placeholder: 'orf.at', maxlength: '2000' });
    var fUser = el('input', { 'class': 'hell-eingabe', type: 'text', value: it.user, autocomplete: 'off', maxlength: '200' });
    var fPass = el('input', { 'class': 'hell-eingabe', type: 'password', value: it.pass, autocomplete: 'new-password', maxlength: '256' });
    var fNotiz = el('textarea', { 'class': 'hell-eingabe', maxlength: '4000' });
    fNotiz.value = it.note;

    var fKat = el('select', { 'class': 'hell-eingabe' });
    fKat.appendChild(el('option', { value: '', text: 'Ohne Reiter' }));
    Z.daten.categories.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (c) {
      var o = el('option', { value: c.id, text: c.name || 'Ohne Namen' });
      if (it.cat === c.id) { o.selected = true; }
      fKat.appendChild(o);
    });

    var wort = el('span', { text: '' });
    var teile = [], i;
    for (i = 0; i < 4; i++) { teile.push(el('div', { 'class': 'staerke__teil' })); }
    var staerke = el('div', { 'class': 'staerke' }, [
      el('div', { 'class': 'staerke__spur' }, teile),
      el('div', { 'class': 'staerke__wort' }, [wort])
    ]);
    var FARBEN = ['var(--rot)', 'var(--rot)', 'var(--messing)', 'var(--gruen)', 'var(--gruen)'];
    var dublette = el('p', { 'class': 'dublette-warnung', style: 'display:none' });
    function staerkeZeigen() {
      var r = V.ratePassword(fPass.value);
      wort.textContent = fPass.value ? r.text + ' · ' + r.bits + ' bit' : '';
      teile.forEach(function (t, idx) {
        t.classList.toggle('staerke__teil--an', idx < r.stufe);
        t.style.setProperty('--f', FARBEN[r.stufe]);
      });
      /* Warnen, wenn dieses Passwort schon woanders im Tresor steht. */
      var andere = V.passwortAndernorts(Z.daten, fPass.value, it.id);
      if (andere.length > 0) {
        var namen = andere.slice(0, 3).map(function (x) { return x.title || V.hostOf(x.url) || 'ohne Titel'; }).join(', ');
        dublette.textContent = 'Dieses Passwort benutzt du schon bei: ' + namen + (andere.length > 3 ? ' und weiteren' : '') + '.';
        dublette.style.display = 'block';
      } else {
        dublette.style.display = 'none';
      }
    }
    fPass.addEventListener('input', staerkeZeigen);

    var augeKnopf = el('button', { 'class': 'tun', type: 'button', title: 'Passwort zeigen' }, [zeichen('auge')]);
    augeKnopf.addEventListener('click', function () {
      fPass.type = fPass.type === 'password' ? 'text' : 'password';
    });

    var leib = el('div', { 'class': 'blatt__leib' }, [
      el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Titel' }), fTitel]),
      el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Adresse' }), fUrl]),
      el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Reiter' }), fKat]),
      el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Benutzer · leer lassen für ein reines Lesezeichen' }), fUser]),
      el('div', { 'class': 'hell-feld' }, [
        el('label', { 'class': 'hell-feld__name', text: 'Passwort' }),
        el('div', { 'class': 'mit-knopf' }, [
          fPass, augeKnopf,
          el('button', {
            'class': 'tun', type: 'button', title: 'Zufallspasswort würfeln',
            onclick: function () { fPass.value = V.generatePassword({ length: 20, zeichen: true }); fPass.type = 'text'; staerkeZeigen(); }
          }, [zeichen('wuerfel')]),
          el('button', {
            'class': 'tun', type: 'button', title: 'Merksatz würfeln',
            onclick: function () { fPass.value = V.generatePassphrase({ words: 5 }); fPass.type = 'text'; staerkeZeigen(); }
          }, [zeichen('feder')])
        ]),
        staerke,
        dublette
      ]),
      el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Notiz' }), fNotiz])
    ]);
    staerkeZeigen();

    function sichern() {
      var titel = fTitel.value.trim();
      var url = fUrl.value.trim();
      if (!titel && !url) { zuruf('Titel oder Adresse muss ausgefüllt sein.', true); return; }
      it.title = titel || V.hostOf(url) || 'Ohne Titel';
      it.url = url;
      it.user = fUser.value.trim();
      it.pass = fPass.value;
      it.note = fNotiz.value;
      it.cat = fKat.value || null;
      it.updatedAt = new Date().toISOString();
      if (neu) { Z.daten.items.push(it); }
      schmutzig(true);
      vorhangZu();
      zeichnen();
      zuruf(neu ? 'Karte angelegt' : 'Karte geändert');
    }

    var fuss = el('div', { 'class': 'blatt__fuss' });
    if (!neu) {
      fuss.appendChild(el('button', {
        'class': 'knopf knopf--leer', style: 'color:var(--rot);border-color:var(--linie);flex:0 0 auto', text: 'Löschen',
        onclick: function () { loeschenFragen(it); }
      }));
    }
    fuss.appendChild(el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Abbrechen', onclick: vorhangZu }));
    fuss.appendChild(el('button', { 'class': 'knopf knopf--voll', text: 'Übernehmen', onclick: sichern }));

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('h2', { 'class': 'blatt__titel', text: neu ? 'Neue Karte' : 'Karte bearbeiten' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      leib, fuss
    ]);
    vorhangAuf(blatt, false);
    setTimeout(function () { fTitel.focus(); }, 30);
  }

  function loeschenFragen(it) {
    /* Kein Nachfragen mehr nötig: gelöscht heißt jetzt in den Papierkorb, und
     * von dort ist alles zurückholbar. Ein Zug, sofort rückgängig zu machen. */
    it.deletedAt = new Date().toISOString();
    it.fav = false;
    it.updatedAt = new Date().toISOString();
    schmutzig(true);
    vorhangZu();
    zeichnen();
    zurufMitZurueck('In den Papierkorb gelegt', function () {
      it.deletedAt = null; it.updatedAt = new Date().toISOString();
      schmutzig(true); zeichnen(); zuruf('Zurückgeholt');
    });
  }

  /* ------------------------------------------------- Blatt: Reiter verwalten */

  function reiterVerwalten() {
    var leib = el('div', { 'class': 'blatt__leib' });

    /* Reihenfolge der Reiter, damit die Pfeile eine klare Ordnung haben. */
    function sortierteKats() {
      return Z.daten.categories.slice().sort(function (a, b) { return a.order - b.order; });
    }
    function ordneNeu() {
      sortierteKats().forEach(function (c, i) { c.order = i; });
    }
    function verschiebe(c, richtung) {
      ordneNeu();
      var liste = sortierteKats();
      var i = liste.indexOf(c);
      var j = i + richtung;
      if (j < 0 || j >= liste.length) { return; }
      var tmp = liste[i].order; liste[i].order = liste[j].order; liste[j].order = tmp;
      schmutzig(true);
      vorhangZu(); reiterVerwalten(); zeichnen();
    }

    function zeileBauen(c, i, gesamt) {
      var name = el('input', { 'class': 'hell-eingabe', type: 'text', value: c.name, maxlength: '40', style: 'font-family:var(--ui)' });
      name.addEventListener('input', function () { c.name = name.value; schmutzig(true); });

      var farbe = el('select', { 'class': 'hell-eingabe', style: 'flex:0 0 7rem' });
      V.CATEGORY_COLORS.forEach(function (f) {
        var o = el('option', { value: f, text: f });
        if (c.color === f) { o.selected = true; }
        farbe.appendChild(o);
      });
      farbe.addEventListener('change', function () {
        c.color = farbe.value; schmutzig(true);
        punkt.style.setProperty('background', 'var(--kat-' + c.color + ')');
      });

      var punkt = el('span', { 'class': 'reiter__farbe', stil: 'background:var(--kat-' + c.color + ');width:12px;height:12px' });

      var hoch = el('button', {
        'class': 'tun', title: 'Nach oben', 'aria-label': 'Reiter nach oben',
        onclick: function () { verschiebe(c, -1); }
      }, [el('span', { text: '\u2191' })]);
      if (i === 0) { hoch.disabled = true; hoch.style.opacity = '.3'; }

      var runter = el('button', {
        'class': 'tun', title: 'Nach unten', 'aria-label': 'Reiter nach unten',
        onclick: function () { verschiebe(c, 1); }
      }, [el('span', { text: '\u2193' })]);
      if (i === gesamt - 1) { runter.disabled = true; runter.style.opacity = '.3'; }

      var weg = el('button', {
        'class': 'tun', title: 'Reiter löschen', 'aria-label': 'Reiter löschen',
        onclick: function () {
          Z.daten.items.forEach(function (it) { if (it.cat === c.id) { it.cat = null; } });
          Z.daten.categories = Z.daten.categories.filter(function (x) { return x.id !== c.id; });
          if (Z.kategorie === c.id) { Z.kategorie = null; }
          schmutzig(true);
          vorhangZu(); reiterVerwalten(); zeichnen();
        }
      }, [el('span', { text: '\u00d7', style: 'font-size:1.1rem' })]);

      return el('div', { 'class': 'mit-knopf', style: 'margin-bottom:.45rem;align-items:center' }, [punkt, name, farbe, hoch, runter, weg]);
    }

    var kats = sortierteKats();
    kats.forEach(function (c, i) {
      leib.appendChild(zeileBauen(c, i, kats.length));
    });
    if (Z.daten.categories.length === 0) {
      leib.appendChild(el('p', { style: 'margin:0 0 .6rem;color:var(--stahl);font-size:.85rem', text: 'Noch keine Reiter. Ohne Reiter geht es auch, aber sortiert findet man schneller.' }));
    }

    var neuName = el('input', { 'class': 'hell-eingabe', type: 'text', placeholder: 'Neuer Reiter, z. B. Banken', maxlength: '40', style: 'font-family:var(--ui)' });
    function anlegen() {
      var n = neuName.value.trim();
      if (!n) { return; }
      var c = V.newCategory(n, V.CATEGORY_COLORS[Z.daten.categories.length % V.CATEGORY_COLORS.length]);
      c.order = Z.daten.categories.length;
      Z.daten.categories.push(c);
      schmutzig(true);
      vorhangZu(); reiterVerwalten(); zeichnen();
    }
    neuName.addEventListener('keydown', function (e) { if (e.key === 'Enter') { anlegen(); } });

    leib.appendChild(el('div', { 'class': 'mit-knopf', style: 'margin-top:1rem' }, [
      neuName,
      el('button', { 'class': 'tun', title: 'Reiter anlegen', onclick: anlegen }, [zeichen('plus')])
    ]));

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('h2', { 'class': 'blatt__titel', text: 'Reiter verwalten' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      leib,
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--voll', text: 'Fertig', onclick: vorhangZu })
      ])
    ]);
    vorhangAuf(blatt);
  }

  /* ------------------------------------------------- Kassensturz */

  function kassensturzZeigen() {
    var a = V.audit(Z.daten);
    var leib = el('div', { 'class': 'blatt__leib' });

    /* Notenkopf. Grün, gelb oder rot je nach Zustand. */
    var farbe = a.note >= 90 ? 'var(--gruen)' : (a.note >= 60 ? 'var(--messing)' : 'var(--rot)');
    leib.appendChild(el('div', { 'class': 'kassensturz-kopf' }, [
      el('div', { 'class': 'kassensturz-note', stil: '--f:' + farbe }, [
        el('span', { 'class': 'kassensturz-zahl', text: String(a.note) }),
        el('span', { 'class': 'kassensturz-proz', text: '%' })
      ]),
      el('div', {}, [
        el('p', { 'class': 'kassensturz-titel', text: a.note >= 90 ? 'Sieht gut aus' : (a.note >= 60 ? 'Ein paar Baustellen' : 'Hier ist was zu tun') }),
        el('p', { 'class': 'kassensturz-unter', text: a.mitPasswort + (a.mitPasswort === 1 ? ' Karte mit Passwort geprüft' : ' Karten mit Passwort geprüft') })
      ])
    ]));

    if (a.doppelt.length === 0 && a.schwach.length === 0) {
      leib.appendChild(el('div', { 'class': 'kassensturz-gut' }, [
        el('div', { 'class': 'kassensturz-gut__zeichen', html: Seal.svg('gut', '✓') }),
        el('p', { text: a.mitPasswort === 0
          ? 'Noch keine Passwörter im Tresor. Sobald welche da sind, prüft der Kassensturz sie hier.'
          : 'Kein Passwort ist doppelt vergeben, keines ist rechnerisch schwach. So soll es sein.' })
      ]));
    }

    function abschnitt(titel, unter, farbe) {
      return el('div', { 'class': 'kassensturz-block' }, [
        el('div', { 'class': 'kassensturz-block__kopf' }, [
          el('span', { 'class': 'kassensturz-block__punkt', stil: 'background:' + farbe }),
          el('span', { 'class': 'kassensturz-block__titel', text: titel }),
          el('span', { 'class': 'kassensturz-block__unter', text: unter })
        ])
      ]);
    }

    function karteReihe(it, extra) {
      var host = V.hostOf(it.url);
      return el('button', {
        'class': 'kassensturz-reihe',
        onclick: function () { vorhangZu(); Z.imPapierkorb = false; blattBearbeiten(it); }
      }, [
        siegel('kassensturz-reihe__siegel', host || it.title || '?', it.title || host),
        el('span', { 'class': 'kassensturz-reihe__titel', text: it.title || host || 'Ohne Titel' }),
        el('span', { 'class': 'kassensturz-reihe__extra', text: extra })
      ]);
    }

    if (a.doppelt.length > 0) {
      var d = abschnitt('Mehrfach benutzt', a.doppelt.length + (a.doppelt.length === 1 ? ' Passwort' : ' Passwörter'), 'var(--rot)');
      a.doppelt.forEach(function (gruppe) {
        var reihe = el('div', { 'class': 'kassensturz-gruppe' });
        gruppe.forEach(function (it) { reihe.appendChild(karteReihe(it, gruppe.length + '×')); });
        d.appendChild(reihe);
      });
      leib.appendChild(d);
    }

    if (a.schwach.length > 0) {
      var s = abschnitt('Schwach', a.schwach.length + (a.schwach.length === 1 ? ' Passwort' : ' Passwörter'), 'var(--messing)');
      a.schwach.forEach(function (it) {
        var r = V.ratePassword(it.pass);
        s.appendChild(karteReihe(it, r.bits + ' bit'));
      });
      leib.appendChild(s);
    }

    if (a.doppelt.length > 0 || a.schwach.length > 0) {
      leib.appendChild(el('p', { 'class': 'kassensturz-fuss', text: 'Auf eine Zeile tippen, um die Karte zu öffnen. Ein neues Passwort würfelst du dort mit dem Würfel-Knopf.' }));
    }

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Kassensturz' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('span', { 'class': 'blatt__siegel', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>' }),
        el('h2', { 'class': 'blatt__titel', text: 'Kassensturz' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      leib,
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--voll', text: 'Fertig', onclick: vorhangZu })
      ])
    ]);
    vorhangAuf(blatt);
  }

  /* ------------------------------------------------- Import */

  function importZeigen() {
    var stand = el('div', { 'class': 'import-stand' });
    var dateiKnopf = el('input', { type: 'file', accept: '.csv,.html,.htm,text/csv,text/html', class: 'nur-lesen' });

    function verarbeiten(datei) {
      if (!datei) { return; }
      if (datei.size > 40 * 1024 * 1024) { setStand('Die Datei ist zu groß.', true); return; }
      var leser = new FileReader();
      leser.onerror = function () { setStand('Die Datei ließ sich nicht lesen.', true); };
      leser.onload = function () {
        var text = String(leser.result || '');
        var istHtml = /\.html?$/i.test(datei.name) || /<a\s[^>]*href/i.test(text.slice(0, 4000));
        var ergebnis;
        try { ergebnis = istHtml ? V.importBookmarks(text) : V.importCsv(text); }
        catch (e) { setStand('Import fehlgeschlagen: ' + e.message, true); return; }
        vorschau(ergebnis, istHtml ? 'Lesezeichen-Datei' : 'CSV-Datei');
      };
      leser.readAsText(datei);
    }

    function setStand(text, warn) {
      leeren(stand);
      stand.appendChild(el('p', { style: 'margin:0;color:' + (warn ? 'var(--rot)' : 'var(--stahl)') + ';font-size:.85rem', text: text }));
    }

    function vorschau(ergebnis, quelle) {
      leeren(stand);
      if (ergebnis.items.length === 0) {
        setStand('In dieser Datei wurde nichts gefunden, das sich importieren lässt.', true);
        return;
      }
      var mitPass = ergebnis.items.filter(function (it) { return it.pass; }).length;
      var lese = ergebnis.items.length - mitPass;
      stand.appendChild(el('div', { 'class': 'import-vorschau' }, [
        el('p', { 'class': 'import-vorschau__zahl', text: String(ergebnis.items.length) }),
        el('p', { 'class': 'import-vorschau__text', text: 'Karten aus ' + quelle }),
        el('ul', { 'class': 'import-vorschau__liste' }, [
          el('li', { text: mitPass + (mitPass === 1 ? ' Zugang mit Passwort' : ' Zugänge mit Passwort') }),
          el('li', { text: lese + (lese === 1 ? ' reines Lesezeichen' : ' reine Lesezeichen') }),
          el('li', { text: ergebnis.categories.length + (ergebnis.categories.length === 1 ? ' neuer Reiter' : ' neue Reiter') })
        ]),
        el('button', {
          'class': 'knopf knopf--voll', style: 'margin-top:1rem', text: 'Diese ' + ergebnis.items.length + ' übernehmen',
          onclick: function () {
            var e = V.mergeImport(Z.daten, ergebnis);
            schmutzig(true);
            vorhangZu();
            zeichnen();
            var teile = [e.neueItems + ' übernommen'];
            if (e.dubletten > 0) { teile.push(e.dubletten + ' Dubletten übersprungen'); }
            zuruf(teile.join(' · '));
          }
        }),
        ergebnis.uebersprungen > 0
          ? el('p', { style: 'margin:.6rem 0 0;font-size:.75rem;color:var(--stahl)', text: ergebnis.uebersprungen + ' leere Zeilen wurden übersprungen.' })
          : null
      ]));
    }

    dateiKnopf.addEventListener('change', function (e) { verarbeiten(e.target.files[0]); e.target.value = ''; });

    var ablage = el('div', { 'class': 'ablage-hell', tabindex: '0', role: 'button' }, [
      'Datei hierher ziehen oder klicken', el('br'),
      el('span', { style: 'font-size:.75rem;opacity:.7', text: 'CSV aus einem Passwortmanager oder Lesezeichen als HTML' })
    ]);
    ablage.addEventListener('click', function () { dateiKnopf.click(); });
    ablage.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dateiKnopf.click(); } });
    ablage.addEventListener('dragover', function (e) { e.preventDefault(); ablage.classList.add('ablage-hell--bereit'); });
    ablage.addEventListener('dragleave', function () { ablage.classList.remove('ablage-hell--bereit'); });
    ablage.addEventListener('drop', function (e) {
      e.preventDefault(); ablage.classList.remove('ablage-hell--bereit');
      if (e.dataTransfer && e.dataTransfer.files[0]) { verarbeiten(e.dataTransfer.files[0]); }
    });

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Import' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('h2', { 'class': 'blatt__titel', text: 'Import' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      el('div', { 'class': 'blatt__leib' }, [
        el('p', { style: 'margin:0 0 .9rem;font-size:.85rem;color:var(--stahl);line-height:1.6' },
          ['Hol dir deine Zugänge und Lesezeichen aus einem anderen Programm herein. Aus ',
           el('b', { text: 'Bitwarden, KeePass, Chrome, Firefox' }),
           ' und den meisten anderen als CSV. Browser-Lesezeichen als HTML-Export. Nichts verlässt dabei dieses Fenster.']),
        ablage,
        dateiKnopf,
        stand
      ]),
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Schließen', onclick: vorhangZu })
      ])
    ]);
    vorhangAuf(blatt);
  }

  /* ------------------------------------------------- Master-Passwort ändern */

  function masterAendern() {
    var alt = el('input', { 'class': 'hell-eingabe', type: 'password', autocomplete: 'current-password', placeholder: 'Jetziges Master-Passwort' });
    var neu1 = el('input', { 'class': 'hell-eingabe', type: 'password', autocomplete: 'new-password', placeholder: 'Neues Master-Passwort' });
    var neu2 = el('input', { 'class': 'hell-eingabe', type: 'password', autocomplete: 'new-password', placeholder: 'Neues Passwort wiederholen' });
    var fehler = el('p', { style: 'margin:.4rem 0 0;color:var(--rot);font-size:.8rem;display:none' });

    var teile = [], i;
    for (i = 0; i < 4; i++) { teile.push(el('div', { 'class': 'staerke__teil' })); }
    var wort = el('span', { text: '' });
    var staerke = el('div', { 'class': 'staerke' }, [el('div', { 'class': 'staerke__spur' }, teile), el('div', { 'class': 'staerke__wort' }, [wort])]);
    var FARBEN = ['var(--rot)', 'var(--rot)', 'var(--messing)', 'var(--gruen)', 'var(--gruen)'];
    neu1.addEventListener('input', function () {
      var r = V.ratePassword(neu1.value);
      wort.textContent = neu1.value ? r.text + ' · ' + r.bits + ' bit' : '';
      teile.forEach(function (t, idx) { t.classList.toggle('staerke__teil--an', idx < r.stufe); t.style.setProperty('--f', FARBEN[r.stufe]); });
    });

    function zeigeFehler(t) { fehler.textContent = t; fehler.style.display = 'block'; }

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Master-Passwort ändern' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('h2', { 'class': 'blatt__titel', text: 'Master-Passwort ändern' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      el('div', { 'class': 'blatt__leib' }, [
        el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Zur Sicherheit: jetziges Passwort' }), alt]),
        el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Neues Passwort' }), neu1, staerke]),
        el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Wiederholung' }), neu2]),
        fehler,
        el('p', { style: 'margin:.9rem 0 0;font-size:.78rem;color:var(--stahl);line-height:1.55', text: 'Das neue Passwort gilt, sobald du speicherst. Wer eine Kopie des Tresors hat, braucht weiter das alte Passwort für diese Kopie. Auch für das neue gilt: es gibt keine Wiederherstellung.' })
      ]),
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Abbrechen', onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--voll', text: 'Ändern und speichern',
          onclick: function () {
            fehler.style.display = 'none';
            if (alt.value !== Z.passwort) { zeigeFehler('Das jetzige Passwort stimmt nicht.'); return; }
            if (neu1.value.length < 12) { zeigeFehler('Das neue Passwort braucht mindestens 12 Zeichen.'); return; }
            if (neu1.value !== neu2.value) { zeigeFehler('Die beiden neuen Passwörter sind nicht gleich.'); return; }
            if (V.ratePassword(neu1.value).stufe < 2) { zeigeFehler('Das neue Passwort ist zu schwach.'); return; }
            if (neu1.value === Z.passwort) { zeigeFehler('Das ist dasselbe wie vorher.'); return; }
            Z.passwort = neu1.value;
            Z.kdf = geraeteKdf();
            schmutzig(true);
            vorhangZu();
            speichern().then(function (ok) { if (ok) { zuruf('Master-Passwort geändert'); } });
          }
        })
      ])
    ]);
    vorhangAuf(blatt, false);
    setTimeout(function () { alt.focus(); }, 30);
  }

  /* ------------------------------------------------- Notfallzettel */

  function notfallzettelZeigen() {
    var vorschlagDatei = (Z.dateiHandle && Z.dateiHandle.name) ? Z.dateiHandle.name : (sauberName() + '.peter');
    var fProgramm = el('input', { 'class': 'hell-eingabe', type: 'text', placeholder: 'z. B. USB-Stick, Ordner Dokumente', value: '' });
    var fDatei = el('input', { 'class': 'hell-eingabe', type: 'text', value: vorschlagDatei });

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Notfallzettel', style: 'max-width:460px' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('span', { 'class': 'blatt__siegel', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l3 3v17H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>' }),
        el('h2', { 'class': 'blatt__titel', text: 'Notfallzettel' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      el('div', { 'class': 'blatt__leib' }, [
        el('p', { style: 'margin:0 0 1rem;font-size:.86rem;color:var(--stahl);line-height:1.6' },
          ['Weil es keine Wiederherstellung gibt, ist dieser Zettel eure Absicherung. Er wird ausgedruckt, das Master-Passwort mit der ',
           el('b', { text: 'Hand' }),
           ' eingetragen und zu den wichtigen Dokumenten gelegt. Auf dem Zettel steht ',
           el('b', { text: 'niemals' }),
           ' ein Passwort, er wird also nicht durch das Drucken zur Gefahr.']),
        el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Wo liegt die Tresordatei?' }), fDatei]),
        el('div', { 'class': 'hell-feld' }, [el('label', { 'class': 'hell-feld__name', text: 'Wo liegt das Programm PasswortPeter.html? (frei)' }), fProgramm])
      ]),
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Abbrechen', onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--voll', text: 'Vorschau & Drucken',
          onclick: function () { notfallDrucken({ datei: fDatei.value.trim(), programm: fProgramm.value.trim() }); }
        })
      ])
    ]);
    vorhangAuf(blatt, false);
    setTimeout(function () { fProgramm.focus(); }, 30);
  }

  function notfallDrucken(ort) {
    var t = V.notfallText(Z.daten, ort);
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
        el('div', { 'class': 'nz-siegel', html: Seal.svg(t.tresor, t.tresor) }),
        el('div', {}, [
          el('h1', { 'class': 'nz-titel', text: 'Notfallzettel' }),
          el('p', { 'class': 'nz-unter', text: 'PasswortPeter · ' + t.datum })
        ])
      ]),

      el('div', { 'class': 'nz-abschnitt' }, [
        zeile('Tresor:', t.tresor),
        zeile('Tresordatei:', t.dateiOrt),
        zeile('Programm liegt bei:', t.programmOrt)
      ]),

      el('div', { 'class': 'nz-passwortkasten' }, [
        el('p', { 'class': 'nz-passwortkasten__label', text: 'Master-Passwort (mit der Hand eintragen):' }),
        el('div', { 'class': 'nz-linie' }),
        el('div', { 'class': 'nz-linie' })
      ]),

      el('div', { 'class': 'nz-abschnitt' }, [
        el('p', { 'class': 'nz-h', text: 'So kommt ihr an die Passwörter:' }),
        el('ol', { 'class': 'nz-schritte' }, t.schritte.map(function (s) { return el('li', { text: s }); }))
      ]),

      el('div', { 'class': 'nz-warnung', text: t.warnung }),

      el('p', { 'class': 'nz-fuss', text: 'Diesen Zettel sicher aufbewahren. Wer ihn hat und das Passwort kennt, kann den Tresor öffnen.' })
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
    var s = Z.daten.settings || V.defaultSettings();

    var lockWerte = [
      { v: 1, t: '1 Minute' }, { v: 5, t: '5 Minuten' }, { v: 15, t: '15 Minuten' },
      { v: 30, t: '30 Minuten' }, { v: 0, t: 'Nie (nicht empfohlen)' }
    ];
    var fLock = el('select', { 'class': 'hell-eingabe' });
    lockWerte.forEach(function (o) {
      var opt = el('option', { value: String(o.v), text: o.t });
      if (o.v === s.autoLockMin) { opt.selected = true; }
      fLock.appendChild(opt);
    });

    var kdfWerte = [
      { v: 'sparsam', t: 'Sparsam · 48 MiB · für ältere Handys' },
      { v: 'standard', t: 'Standard · 128 MiB · empfohlen' },
      { v: 'streng', t: 'Streng · 256 MiB · langsamer, sicherer' }
    ];
    var fKdf = el('select', { 'class': 'hell-eingabe' });
    kdfWerte.forEach(function (o) {
      var opt = el('option', { value: o.v, text: o.t });
      if (o.v === s.kdf) { opt.selected = true; }
      fKdf.appendChild(opt);
    });

    var blatt = el('div', { 'class': 'blatt', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Einstellungen', style: 'max-width:440px' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('h2', { 'class': 'blatt__titel', text: 'Einstellungen' }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      el('div', { 'class': 'blatt__leib' }, [
        el('div', { 'class': 'hell-feld' }, [
          el('label', { 'class': 'hell-feld__name', text: 'Von selbst zusperren nach' }), fLock,
          el('p', { style: 'margin:.35rem 0 0;font-size:.76rem;color:var(--stahl)', text: 'Ohne Bewegung sperrt der Tresor von allein. Im Hintergrund (anderer Tab) immer schneller.' })
        ]),
        el('div', { 'class': 'hell-feld' }, [
          el('label', { 'class': 'hell-feld__name', text: 'Stärke der Schlüsselableitung' }), fKdf,
          el('p', { style: 'margin:.35rem 0 0;font-size:.76rem;color:var(--stahl)', text: 'Bremst jeden, der das Passwort raten will. Höher ist sicherer, aber das Aufsperren dauert länger. Gilt ab dem nächsten Speichern.' })
        ])
      ]),
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Abbrechen', onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--voll', text: 'Übernehmen',
          onclick: function () {
            var neuLock = parseInt(fLock.value, 10);
            var neuKdf = fKdf.value;
            var kdfGeaendert = neuKdf !== s.kdf;
            Z.daten.settings = V.sanitizeSettings({ autoLockMin: neuLock, kdf: neuKdf });
            if (kdfGeaendert) { Z.kdf = geraeteKdf(); }
            schmutzig(true);
            vorhangZu();
            ruheAnstossen();
            zuruf(kdfGeaendert ? 'Einstellungen übernommen · beim Speichern neu verschlüsselt' : 'Einstellungen übernommen');
          }
        })
      ])
    ]);
    vorhangAuf(blatt);
  }

  /* ------------------------------------------------- Menü in der Leiste */

  function menueZeigen() {
    function eintrag(text, klick, rot) {
      return el('button', {
        'class': 'menue__eintrag' + (rot ? ' menue__eintrag--rot' : ''),
        onclick: function () { vorhangZu(); klick(); }
      }, [text]);
    }
    var blatt = el('div', { 'class': 'blatt menue', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menü', style: 'max-width:320px' }, [
      el('div', { 'class': 'blatt__kopf' }, [
        el('h2', { 'class': 'blatt__titel', text: Z.daten.name }),
        el('button', { 'class': 'blatt__zu', 'aria-label': 'Schließen', text: '\u00d7', onclick: vorhangZu })
      ]),
      el('div', { 'class': 'menue__leib' }, [
        eintrag('Kassensturz', kassensturzZeigen),
        eintrag('Notfallzettel drucken …', notfallzettelZeigen),
        eintrag('Import …', importZeigen),
        eintrag('Einstellungen …', einstellungenZeigen),
        eintrag('Master-Passwort ändern …', masterAendern),
        eintrag('Als CSV exportieren …', exportFragen, true)
      ])
    ]);
    vorhangAuf(blatt);
  }

  function exportFragen() {
    var blatt = el('div', { 'class': 'blatt', role: 'alertdialog', 'aria-modal': 'true', style: 'max-width:420px' }, [
      el('div', { 'class': 'blatt__kopf' }, [el('h2', { 'class': 'blatt__titel', text: 'Als CSV exportieren?' })]),
      el('div', { 'class': 'blatt__leib' }, [
        el('div', { 'class': 'warnung-hell' }, [
          el('strong', { text: 'Diese Datei ist NICHT verschlüsselt.' }),
          document.createTextNode(' Jedes Passwort steht darin im Klartext, für jeden lesbar. Nur benutzen, um zu einem anderen Programm zu wechseln, und die Datei sofort danach sicher löschen.')
        ])
      ]),
      el('div', { 'class': 'blatt__fuss' }, [
        el('button', { 'class': 'knopf knopf--leer', style: 'color:var(--tinte);border-color:var(--linie)', text: 'Lieber nicht', onclick: vorhangZu }),
        el('button', {
          'class': 'knopf knopf--voll', style: 'background:var(--rot);color:#fff', text: 'Klartext-CSV herunterladen',
          onclick: function () {
            var csv = V.exportCsv(Z.daten);
            try {
              var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              var url = URL.createObjectURL(blob);
              var a = el('a', { href: url, download: sauberName() + '_KLARTEXT.csv' });
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
              zuruf('Klartext-CSV heruntergeladen. Bitte sicher löschen.', true);
            } catch (e) { zuruf('Der Browser hat den Download verweigert.', true); }
            vorhangZu();
          }
        })
      ])
    ]);
    vorhangAuf(blatt, false);
  }

  /* ------------------------------------------------- Verknüpfen */

  function verknuepfen() {
    $('b-datei').addEventListener('change', function (e) { dateiLesen(e.target.files[0]); e.target.value = ''; });
    $('ablage').addEventListener('click', function () { dateiWaehlen(); });
    $('ablage').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dateiWaehlen(); } });
    $('b-neuer-tresor').addEventListener('click', aufbauenNeu);

    ['dragenter', 'dragover'].forEach(function (t) {
      document.addEventListener(t, function (e) {
        if (!$('s-start').classList.contains('versteckt')) { e.preventDefault(); $('ablage').classList.add('ablage--bereit'); }
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      document.addEventListener(t, function (e) {
        e.preventDefault(); $('ablage').classList.remove('ablage--bereit');
        if (t === 'drop' && !$('s-start').classList.contains('versteckt') && e.dataTransfer && e.dataTransfer.files[0]) {
          dateiLesen(e.dataTransfer.files[0]);   // per Ziehen gibt es kein Handle
        }
      });
    });

    $('b-speichern').addEventListener('click', function () { speichern(); });
    $('b-menue').addEventListener('click', menueZeigen);
    $('b-sortieren').addEventListener('click', sortierUmschalten);
    $('b-sperren').addEventListener('click', function () {
      if (Z.schmutzig && !window.confirm('Es gibt ungespeicherte Änderungen. Trotzdem zusperren und sie verwerfen?')) { return; }
      sperren();
    });
    $('b-neu-eintrag').addEventListener('click', function () { blattBearbeiten(null); });
    $('suche').addEventListener('input', function (e) { Z.suche = e.target.value; karteiZeichnen(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('vorhang-halter').firstChild) { vorhangZu(); return; }
      if (!Z.daten) { return; }
      if ((e.key === 'k' || e.key === 'f') && (e.ctrlKey || e.metaKey) && !$('vorhang-halter').firstChild) {
        e.preventDefault(); var s = $('suche'); if (s) { s.focus(); s.select(); }
      }
      if (e.key === '/' && document.activeElement !== $('suche') && !$('vorhang-halter').firstChild &&
          (!document.activeElement || ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(document.activeElement.tagName) < 0)) {
        e.preventDefault(); $('suche').focus();
      }
      if (e.key === 'l' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sperren(); }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); speichern(); }
    });

    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (t) {
      document.addEventListener(t, function () { if (Z.daten && !$('vorhang-halter').firstChild) { ruheAnstossen(); } }, { passive: true });
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

  var SORT_FOLGE = ['name', 'benutzt', 'neu'];
  var SORT_NAME = { name: 'A–Z', benutzt: 'Zuletzt benutzt', neu: 'Neueste zuerst' };
  function sortierUmschalten() {
    var i = SORT_FOLGE.indexOf(Z.sortierung);
    Z.sortierung = SORT_FOLGE[(i + 1) % SORT_FOLGE.length];
    var b = $('b-sortieren');
    if (b) { b.textContent = SORT_NAME[Z.sortierung]; }
    karteiZeichnen();
    zuruf('Sortierung: ' + SORT_NAME[Z.sortierung]);
  }

  /* ------------------------------------------------- Start */

  function starten() {
    if (!window.sodium) { fehlstart('libsodium fehlt. Die Datei ist unvollständig.'); return; }
    window.sodium.ready.then(function () {
      if (typeof window.sodium.crypto_pwhash !== 'function') {
        fehlstart('Dieser libsodium-Build kennt kein Argon2id. Die Datei ist der falsche Build.');
        return;
      }
      V.init(window.sodium);
      Seal.init(window.sodium);
      verknuepfen();
      $('laedt').classList.add('versteckt');
      zeige('s-start');
      $('start-siegel-halter').replaceChildren(siegel('kasten__siegel', 'PasswortPeter', 'P'));
    }).catch(function (e) {
      fehlstart('libsodium ließ sich nicht starten: ' + (e && e.message ? e.message : e));
    });
  }

  function fehlstart(text) {
    var l = $('laedt');
    l.classList.remove('versteckt');
    leeren(l);
    l.appendChild(el('div', { 'class': 'kasten__mitte' }, [
      el('p', { 'class': 'kasten__marke', text: 'Fehlstart' }),
      el('div', { 'class': 'warnung', text: text })
    ]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', starten);
  } else { starten(); }

  /* Nur für die Testreihe. Im Browser stört es niemanden. */
  window.PPApp = {
    zustand: Z,
    kann: { ueberschreiben: KANN_UEBERSCHREIBEN, oeffnenMitHandle: KANN_OEFFNEN_MIT_HANDLE },
    speichern: speichern,
    sperren: sperren,
    zeichnen: zeichnen,
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
    loeschenFragen: loeschenFragen,
    appAufbauen: appAufbauen,
    dateiLesen: dateiLesen
  };
}());
