# PasswortPeter – Handover v0.4

Stand: 20.07.2026 · Ersetzt Handover v0.3 vollständig

---

## 1. Kurzfassung für einen frischen Chat

Passwortmanager für eine dreiköpfige Familie. Eine einzige HTML-Datei, **1,20 MB**,
per Doppelklick unter `file://`. Kein Server, kein Konto, kein Browser-Speicher, kein
Netzzugriff. Ein Tresor ist eine `.peter`-Datei plus ein Master-Passwort.

**Prüfstand: 162 Kerntests + 95 Tests an der gebauten Datei, alle grün.** Der
DOM-Testlauf endet mit null Netzversuchen und ohne Konsolenfehler. **Weiterhin nie in
einem echten Browser gelaufen** (jsdom ist kein Browser, Playwright/Chromium im
Container gesperrt) – das bleibt die zentrale Einschränkung, siehe Abschnitt 6.

Die Grundentscheidungen aus v0.2 gelten unverändert: Zero-Knowledge, **keine
Wiederherstellung**, jede Website ist eine Karte (mit Zugang oder als Lesezeichen),
Datei per Doppelklick statt Server. v0.3 brachte Kassensturz, Import, Papierkorb,
Master-Passwort ändern und das Überschreiben derselben Datei.

---

## 2. Was v0.4 neu bringt

Diese Version war ausdrücklich der Auftrag, das Programm „perfekt" zu machen. Der Fokus
lag deshalb auf dem größten ungelösten Risiko der ganzen Architektur: Weil es **keine
Wiederherstellung** gibt, hängt der Zugang der Familie allein daran, dass jemand das
Passwort kennt und die Datei findet. Zwei der neuen Funktionen zielen genau darauf.

### Notfallzettel (der wichtigste Zusatz)

Ein ausdruckbarer Zettel mit Tresorname, Ablageort der Datei und einer Anleitung für
den Ernstfall – aber **niemals mit einem Passwort**. Ein Feld zum Eintragen des
Master-Passworts von Hand. Gedacht zum Ablegen bei den wichtigen Dokumenten.

- `V.notfallText(vault, ort)` liefert nur Textbausteine (kein DOM, testbar). Ein Test
  stellt sicher, dass da **kein** Passwortfeld drin ist.
- Der Druck läuft über eine eigene Druckansicht (`#druck-halter`) und die Body-Klasse
  `drucke-nz`. Die Druck-CSS blendet im Normalfall alles aus („druckt keine Tresore")
  und zeigt beim Notfallzettel nur diesen. Nach `afterprint` (oder 60-s-Notbremse)
  wird die Ansicht wieder entfernt und der Inhalt gelöscht.
- Im DOM-Test bewiesen: Zettel wird aufgebaut, nennt den Tresor, hat das Passwortfeld,
  enthält **kein** echtes Passwort, löst `window.print()` aus, räumt danach auf.

### Merksatz-Generator

`V.generatePassphrase({words, sep, caps, zahl})` aus einer eingebetteten Liste von
**395 einfachen deutschen Wörtern** (ohne Umlaute/ß, leicht zu tippen). 6 Wörter ≈ 58
bit, 7 ≈ 67 bit; `V.passphraseBits(opts)` rechnet das ehrlich aus. Gleichverteilte
Wortauswahl (32-Bit-Ziehung ohne Modulo-Schiefstand), im Test gegen ~80 Treffer je
Wort geprüft. Angeboten beim Anlegen eines Tresors (Master-Passwort) und als zweiter
Würfel-Knopf im Karten-Editor. Motiv: das Master-Passwort ist das einzige, das man
sich merken **muss**, und ein Merksatz ist merkbar und stark zugleich.

### Einstellungen (pro Tresor, in der Datei gespeichert)

`data.settings = { autoLockMin, kdf }`, von `sanitizeSettings` validiert, überlebt den
verschlüsselten Rundlauf, ist abwärtskompatibel (alte Dateien bekommen den Standard).

- **Autosperre**: 1 / 5 / 15 / 30 min oder nie. `sperreMs()` liest das, `ruheAnstossen`
  richtet sich danach.
- **KDF-Stärke**: sparsam (48 MiB) / standard (128 MiB) / streng (256 MiB).
  `geraeteKdf()` versucht die gewählte Stärke und weicht bei Überforderung des Geräts
  nach unten aus. Damit kann ein schwaches Handy „sparsam" fahren und ein vorsichtiger
  Nutzer „streng". Gilt ab dem nächsten Speichern.

### Dublettenwarnung im Editor

`V.passwortAndernorts(vault, pass, ausserId)` findet andere lebende Einträge mit
demselben Passwort (übergeht Papierkorb und sich selbst). Der Editor blendet live eine
Warnung ein und nennt die betroffenen Karten. Ergänzt den Kassensturz um Vorbeugung
statt nur Nachschau.

### Kleineres

- **Reiter umsortieren**: Hoch/Runter-Pfeile in „Reiter verwalten" (statt Drag, weil
  testbar). Tauscht `order`.
- **Fokusfalle**: In jedem Dialog bleibt Tab/Shift-Tab im Dialog; Fokus kehrt beim
  Schließen zum auslösenden Element zurück.
- **Lock im Hintergrund**: `visibilitychange` sperrt nach 45 s im versteckten Tab –
  aber nur, wenn nichts Ungespeichertes wartet.

---

## 3. Datenmodell-Änderungen gegenüber v0.3

Nur additiv und abwärtskompatibel:

```
vault:  … , settings { autoLockMin:int, kdf:'sparsam'|'standard'|'streng' }
```

`emptyVault` legt Standard-Settings an, `sanitize` ruft `sanitizeSettings(raw.settings)`.
Item-Felder unverändert gegenüber v0.3 (`usedAt`, `deletedAt`). Dateiformat `.peter`
(Krypto, Header) **unverändert seit v0.2**. Ein v0.4-Tresor öffnet in v0.2/v0.3, die
neuen Felder werden dort ignoriert.

Neue Kernfunktionen: `generatePassphrase`, `passphraseBits`, `wortZahl`,
`passwortAndernorts`, `defaultSettings`, `sanitizeSettings`, `kdfVon`, `notfallText`.

---

## 4. Gemessene Werte

| Was | Wert |
|---|---|
| Fertige HTML-Datei | 1,20 MB |
| Wörter in der Merksatz-Liste | 395 (6 Wörter ≈ 58 bit, 7 ≈ 67 bit) |
| Kerntests | 162, grün |
| DOM-Tests an der gebauten Datei | 95, grün |
| Netzversuche im DOM-Testlauf | 0 |

Argon2id-Zeiten aus v0.2: 128 MiB/t=3 ≈ 0,9 s am Rechner, 256 MiB ≈ 1,9 s, 48 MiB
deutlich schneller. Auf älteren Handys jeweils das Drei- bis Fünffache.

---

## 5. Vollständiger Funktionsumfang v0.4

Anlegen/öffnen (Dateidialog, Ziehen, oder File-Handle-Picker), auf-/zusperren,
Autosperre (einstellbar) + Countdown bei ungespeicherten Änderungen + Lock im
Hintergrund. Karten anlegen/ändern/löschen (Papierkorb mit Zurückholen). Felder:
Titel, Adresse, Reiter, Benutzer, Passwort, Notiz, Favorit. Lesezeichen = Karte ohne
Zugangsdaten. Reiter anlegen/umbenennen/einfärben/**umsortieren**/löschen. Suche;
Sortierung A–Z / zuletzt benutzt / neueste. Website öffnen (nur http/https).
Kopieren von Benutzer und Passwort (Ablage löscht sich nach 20 s). Zwei
Passwortgeneratoren (Zufall + **Merksatz**), Stärke in bit, **Dublettenwarnung**.
Speichern (dieselbe Datei überschreiben, wo möglich; sonst Download).
**Kassensturz**, **Import** (CSV + Lesezeichen), **Master-Passwort ändern**,
**Einstellungen**, **Notfallzettel**, CSV-Export (Klartext, mit Warnung).
Siegel statt Favicons (offline aus BLAKE2b). `Strg+S/L`, `/` und `Strg+K` für Suche,
`Esc`. **Fokusfalle** in Dialogen.

---

## 6. Was weiterhin offen ist

**Immer noch nie in einem echten Browser gelaufen.** Wichtigste Einschränkung,
unverändert. Nach Risiko geordnet ungeprüft:

1. **Notfallzettel-Druck im echten Browser.** In jsdom ist `window.print` nur ein
   Platzhalter. Ob die Druck-CSS (`@media print`, `drucke-nz`) auf echtem Papier
   sauber genau den Zettel und nichts anderes zeigt, ist ungeprüft. Erster Ort zum
   Hinschauen, falls beim Drucken Tresordaten mit aufs Blatt geraten – das wäre ein
   ernster Fehler, der Testgedanke dahinter (`nz`-Test) prüft nur den Inhalt, nicht
   das echte Druckbild.
2. **File System Access unter `file://`** (aus v0.3): „should", nicht „must".
   Download-Fallback vorhanden.
3. **CSP-Zeile** (unverändert): erster Verdacht, falls gar nichts startet.
4. **Zwischenablage/Download unter `file://`**, besonders iOS Safari.

**v0.5 beginnt erst, wenn der Nutzer die Datei in seinen echten Browsern getestet
hat** – besonders den Notfallzettel-Druck. Das gilt seit v0.2 und weiter.

Nicht gebaut (bewusst): TOTP, Zusammenführen auseinandergelaufener Kopien, Reiter per
echtem Drag.

---

## 7. Bauen und Prüfen

```bash
cd lib && npm install libsodium-wrappers-sumo@0.7.15 jsdom@25.0.1
cd ../pp
node test/test_vault.js     # 162 Kernprüfungen
python3 build.py            # baut dist/PasswortPeter.html und prüft sie
node test/test_dom.js       # 95 Prüfungen an der fertigen Datei in jsdom
```

`build.py`-Gates unverändert (kein `</script>`, keine externen Quellen, keine
Netz-/Storage-Aufrufe im eigenen Code, `connect-src 'none'`/`default-src 'none'`).
`test_dom.js` nagelt alle Netzwege zu; Lauf endet mit null. Realm-Fallstrick aus v0.3
gilt weiter: gegen `w.Uint8Array` prüfen, nicht Nodes globales.

---

## 8. Dateien

```
pp/
  build.py
  src/
    shell.html   Gerüst; jetzt mit #druck-halter für den Notfallzettel
    style.css    Karteikasten + v0.3-Block + v0.4-Block (Notfallzettel-Druck, Settings, Dublette)
    vault.js     Kern; + Merksatz/Wortliste, Settings, Dublettenprüfung, notfallText. Kein DOM.
    seal.js      Siegel aus BLAKE2b
    app.js       Bildschirme; + Notfallzettel, Einstellungen, Dublettenwarnung,
                 Reiter-Reihenfolge, Fokusfalle, Lock im Hintergrund
    *.v02 / *.v03  Sicherungen früherer Stände
  test/
    test_vault.js   162 Prüfungen
    test_dom.js     95 Prüfungen
  dist/
    PasswortPeter.html, ANLEITUNG.md (mit v0.4-Abschnitt), HANDOVER_v0.4.md
```

`vault.js` bleibt DOM-frei. So lassen.

---

## 9. Konventionen (unverändert)

- Je Version: ein Paket plus fortgeschriebenes Handover. Deutsch. Keine Frameworks,
  keine CDNs, kein Netzzugriff zur Laufzeit.
- Fragen sammeln, gebündelt stellen, dann durcharbeiten.
- Nichts behaupten, was nicht gemessen ist. Diese Disziplin hat über vier Versionen
  je mindestens eine falsche Annahme abgefangen (libsodium-Standardbuild ohne
  Argon2id; File System Access unbrauchbar außer Chrome/Edge; `Buffer` fehlt im
  Browser; Bitwardens Spaltennamen; Realm-`Uint8Array`). Sie ist der Grund, warum das
  Programm trotz fehlendem echten Browser tragfähig ist.
