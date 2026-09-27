# PasswortPeter – Handover v1.0

Stand: 27.09.2026 · Ersetzt Handover v0.4 vollständig

---

## 1. Kurzfassung für einen frischen Chat

Passwortmanager und Lesezeichen-Tresor für eine Familie. Eine einzige HTML-Datei,
**1,34 MB**, per Doppelklick unter `file://`. Kein Server, kein Konto, kein
Browser-Speicher, kein Netzzugriff. Ein Tresor ist eine `.peter`-Datei plus ein
Master-Passwort.

v1.0 war der Auftrag, die App „sicherer und umfangreicher“ zu machen und
„optisch und im Umfang wesentlich besser“; der Nutzer sammelt darin vor allem
**Websites (Favoriten) samt Passwort, wo nötig**. Entscheidungen des Nutzers
vor dem Bau:

- alle vier Pakete: A Aussehen & Handy, B Favoriten, C Sicherheit, D Browser-Tests,
- **Englisch als zweite Oberflächensprache**, Deutsch bleibt Hauptsprache,
- **kein TOTP** (2FA bleibt am Handy, getrennt vom Tresor),
- **keine Schlüsseldatei** (ohne Wiederherstellung wäre sie ein zweites Ding zum Verlieren),
- **komplett neue Optik**, nicht nur der Karteikasten poliert.

**Prüfstand: 230 Kerntests + 166 Tests an der gebauten Datei (jsdom) + 56 Tests im
echten Chromium, alle grün.** Zum ersten Mal lief die Datei in einem echten Browser.
Die Grundentscheidungen aus v0.2 gelten unverändert: Zero-Knowledge, **keine
Wiederherstellung**, jede Website ist eine Karte, Datei per Doppelklick.

---

## 2. Was v1.0 neu bringt

### A · Neue Oberfläche

- **Neu gezeichnet**: helle App-Optik mit einer Akzentfarbe (Petrol), Seitenleiste
  links, große Suche oben, Karten als **Kacheln oder Liste**, runde Dialoge.
  Farben als Marken (Tokens) in `:root`.
- **Dunkles Erscheinungsbild**: automatisch nach System, oder fest „hell“/„dunkel“
  über die Einstellungen (`data-theme` am `<html>`).
- **Handy**: Seitenleiste als Schublade hinter ☰, Dialoge kommen als Blatt von
  unten, runder Plus-Knopf, Zurufe oberhalb des Plus-Knopfs (bei offenem Blatt
  oben). Im echten Chromium bei 390 × 844 geprüft: nirgends seitliches Scrollen.
- **Übersicht** als Startansicht: Kennzahlen, **Favoriten als große Kacheln**
  (Startseite), „Zuletzt geöffnet“, Reiter-Kacheln, Hinweisbanner.
- **Eigenes Symbol je Karte**: ein Emoji und eine Farbe; ohne Emoji weiter das
  Siegel aus BLAKE2b.
- **Zweite Sprache Englisch**: `src/i18n.js`, 444 Schlüssel je Sprache. Vor dem
  Aufsperren entscheidet die Browsersprache (Standard Deutsch) oder der Schalter
  DE/EN auf dem Startschirm; danach die Einstellung im Tresor. Fehler aus dem Kern
  tragen eine Kennung (`e.code`) und werden übersetzt.
- **„Über PasswortPeter“** mit Version, Dateiformat und Tastenkürzeln.

### B · Websites und Favoriten

- **Mehrere Adressen je Karte** (`urls`, mit Bezeichnung).
- **Schlagwörter** quer zu den Reitern (`tags`), Filter in der Seitenleiste,
  Suche mit `#`. Die Suche verlangt jetzt alle Wörter, egal in welcher Reihenfolge.
- **Eigene Reihenfolge** (`order`, Sortierung „eigen“): Ziehen mit der Maus,
  Pfeile für Tastatur und Touch. In „eigen“ gehen Favoriten bewusst nicht
  automatisch vor.
- **Lesezeichen-Export** als Netscape-HTML für jeden Browser, **ohne** Benutzer,
  Passwörter, Notizen, Zusatzfelder. Reiter werden Ordner; der eigene Import liest
  den Export verlustfrei zurück.
- **Mehrfachauswahl**: in Reiter verschieben, Schlagwort anhängen, Favorit,
  löschen (mit einem Griff zurückholbar).
- **Zuletzt geöffnet** als eigene Ansicht und Streifen in der Übersicht.

### C · Sicherheit

- **Zusatzfelder** (`fields`): PIN, Kundennummer, Sicherheitsfrage …, einzeln
  **verborgen**. Verborgene Werte übergeht die Suche absichtlich, sonst ließen sie
  sich über die Trefferliste erraten.
- **Passwortverlauf** (`history`): beim Ändern wandert das alte Passwort in den
  Verlauf der Karte, höchstens zehn, jüngstes zuerst (`V.setPassword`).
- **Passwortalter** (`passChangedAt`): Anzeige „geändert vor …“, Uhr-Marke an der
  Karte, wenn älter als die Einstellung (6/12/24 Monate, Standard 12, abschaltbar).
- **Sicherheitsansicht** statt Kassensturz-Dialog: Note als Ring, vier Kennzahlen
  (mehrfach, schwach, veraltet, ohne https), Listen mit Sprung in den Editor,
  Stand der Sicherungskopie. Das Detailblatt einer Karte nennt Doppelungen auch.
- **Wartezeit nach Fehlversuchen** beim Aufsperren: ab dem dritten falschen
  Passwort 5, 10, 20, dann 30 s. **Ehrlich eingeordnet:** das bremst nur das Raten
  von Hand an diesem Bildschirm und gilt nur bis zum Neuladen, weil die Datei
  nichts im Browser speichert. Gegen jemanden, der die Datei kopiert hat, hilft
  allein Argon2id. So steht es auch im Code.
- **Sicherungskopie**: Menü → verschlüsselte Kopie mit Datum im Namen;
  `settings.lastBackupAt` wird vermerkt; Banner in der Übersicht nach 7/30/90 Tagen
  (Standard 30, abschaltbar).

### D · Prüfen im echten Browser

- Neu: **`test/test_browser.js`** mit Playwright/Chromium, Teil von `npm run verify`.
  Rundlauf über die echte Oberfläche (Tresor anlegen mit echtem Argon2id, Karten
  anlegen, Strg+S, neu laden, Datei öffnen, falsches und richtiges Passwort),
  CSP blockiert `fetch`, null Netzversuche, Handy-Layout, dunkles Erscheinungsbild,
  Ziehen mit der Maus, Druckbild.
- **Notfallzettel im echten Druck geprüft** (offener Punkt Nr. 1 aus v0.4):
  normales Drucken zeigt nur „PasswortPeter druckt keine Tresore.“; beim
  Notfallzettel ist nur der Zettel sichtbar, der Tresor nicht. Das von Chromium
  erzeugte PDF wurde ausgelesen: eine Seite, nur der Zettel, kein Passwort.
- Bildschirmfotos und das PDF landen bei jedem Lauf in `test/ausgabe/`
  (nicht im Repository).

### Nebenbei gefundene und behobene Fehler

- Zwei statistische Kerntests schlugen gelegentlich **grundlos** an (reines
  Zufallsrauschen, etwa jeder siebte Lauf). Stichproben vergrößert (400 → 2000
  Passwörter, 80 → 400 Treffer je Wort); die Schwellen sind unverändert streng.
- Notfallzettel sagte „das **unten** eingetragene Master-Passwort“, das Feld
  steht aber **oben**. Korrigiert (auch englisch).
- Beim Bau von v1.0 fing die Testreihe ab: Schlagwort mit Leerzeichen vor `#`;
  Favoriten sprangen in „eigener Reihenfolge“ nach vorn; Detailblatt am Handy
  wurde von einer langen Adresse breiter als der Bildschirm; Zuruf verdeckte die
  Knöpfe eines offenen Blatts am Handy. Alle behoben, alle mit eigenem Test.

---

## 3. Datenmodell-Änderungen gegenüber v0.4

**Dateiformat (Kopf, Krypto) unverändert seit v0.2** (`FORMAT_VERSION = 1`).
Alles Neue ist additiv:

```
item:     … , urls [{label,url}], tags [str], fields [{label,value,hidden}],
              history [{pass,until}], passChangedAt iso|null,
              emoji str, color ''|Reiterfarbe, order num
settings: … , lang 'de'|'en', theme 'auto'|'hell'|'dunkel', view 'kacheln'|'liste',
              maxAgeMonths 0|6|12|24, backupDays 0|7|30|90, lastBackupAt iso|null
```

- `sanitize` prüft und begrenzt alles (10 Adressen, 20 Schlagwörter, 30 Felder,
  10 Verlaufseinträge, Emoji = ein Zeichen-Cluster).
- `encrypt` schreibt **leere** v1.0-Felder nicht (`kompakt`), `sanitize` setzt sie
  beim Lesen wieder. So bleibt die Datei fast so klein wie in v0.4
  (500 Karten: 147 KB statt 126 KB; der Rest ist das echte `passChangedAt`).
- **Gemessen**, nicht vermutet (mit dem v0.4-Kern aus git): v0.4 öffnet eine
  1.0-Datei; v0.4 **verwirft beim Speichern** die neuen Felder; 1.0 öffnet eine
  v0.4-Datei mit leeren Standardwerten. Deshalb: alle Geräte auf 1.0 bringen.
  Steht so in der Anleitung.

Neue Kernfunktionen: `setPassword`, `passwordAgeDays`, `allTags`, `parseTags`,
`normTag`, `hatTag`, `moveInList`, `recentlyUsed`, `backupFaellig`,
`exportBookmarksHtml`, `sanitizeEmoji`; `search(…, tag)`, `sortieren(…, 'eigen')`,
`audit(vault, jetzt)` liefert zusätzlich `alt`, `unsicher`, `aufgaben`;
`notfallText(vault, ort, lang)`. Fehler tragen `e.code`.

---

## 4. Gemessene Werte

| Was | Wert |
|---|---|
| Fertige HTML-Datei | 1,34 MB (v0.4: 1,20 MB) |
| Kerntests | 230, grün (15 Läufe am Stück grün) |
| DOM-Tests an der gebauten Datei (jsdom) | 166, grün |
| Tests im echten Chromium (Playwright 1.56.1) | 56, grün |
| Netzversuche in allen Läufen | 0 |
| Textschlüssel je Sprache | 444, beide Sprachen identisch |
| 500 Karten verschlüsselt | 147 KB |

---

## 5. Versionsmarken

Eine Nummer an zwei Stellen, `build.py` bricht ab, wenn sie auseinanderlaufen:

- `package.json` → `"version": "1.0.0"`
- `src/app.js` → `var APP_VERSION = '1.0.0';` (Startschirm, „Über“)

Dazu unabhängig: `FORMAT_VERSION = 1` in `src/vault.js` (Dateiformat, **nicht**
bei jeder App-Version erhöhen, nur wenn sich der Kopf/die Krypto ändert).

---

## 6. Was weiterhin offen ist

Jetzt geprüft: Chromium (Desktop und Handy-Größe), unter `file://`. **Ungeprüft:**

1. **Firefox und Safari/iOS** im echten Gerät. Besonders: Zwischenablage unter
   `file://`, Download auf iOS, `:has()` (nur für die Zuruf-Position bei offener
   Auswahlleiste; ohne `:has()` sitzt er etwas tiefer, sonst keine Folge),
   `color-mix()` (Emoji-Hintergrund; ohne fällt er auf die volle Farbe zurück).
2. **Echter Drucker.** Das PDF aus Chromium stimmt; ein echter Druckdialog mit
   Seitenrändern je Browser nicht angesehen.
3. **File System Access** ist in Chrome real vorhanden, der Dateidialog selbst
   lässt sich nicht fernsteuern; im Test liefert ein nachgestellter Dialog das
   Handle, der Rest (Schreiben, zweimal dieselbe Datei) ist echt.
4. **Merksatz-Wörter sind deutsch**, auch in der englischen Oberfläche.

Nicht gebaut (bewusst, mit dem Nutzer entschieden): TOTP, Schlüsseldatei,
Zusammenführen auseinandergelaufener Kopien, Abgleich mit Leck-Listen (braucht Netz).

---

## 7. Bauen und Prüfen

```bash
npm install             # libsodium, jsdom, playwright (Browser: siehe unten)
npm run verify          # Kern → Bau → jsdom → echtes Chromium
```

Einzeln: `node test/test_vault.js`, `python3 build.py`, `node test/test_dom.js`,
`node test/test_browser.js`. Ohne vorhandenes Chromium einmal
`npx playwright install chromium`.

`build.py` sucht libsodium seit v1.0 zuerst in `./node_modules` (npm install im
Projekt), sonst wie früher in `../lib/node_modules`.

`build.py`-Gates: kein `</script>` im Code, keine externen Quellen, keine Netz-
oder Storage-Aufrufe im eigenen Code (jetzt inkl. `i18n.js`), `connect-src 'none'`,
`default-src 'none'`, **sechs** Skriptblöcke, **jeder benutzte Text in beiden
Sprachen**, **Version in package.json und app.js gleich**, Datei unter 3 MB.

---

## 8. Dateien

```
build.py
package.json, package-lock.json
src/
  shell.html   Gerüst: Startschirm, Seitenleiste, Leiste, Inhalt, Auswahlleiste
  style.css    komplett neu: Tokens hell/dunkel, App-Layout, Handy, Druck, Notfallzettel
  i18n.js      NEU: Deutsch und Englisch, t()/tn(), Datums- und Altersangaben. Kein DOM.
  vault.js     Kern; + v1.0-Felder, Verlauf, Alter, Schlagwörter, Reihenfolge,
               Sicherung, Lesezeichen-Export, Fehlerkennungen. Kein DOM.
  seal.js      Siegel aus BLAKE2b (unverändert)
  app.js       Oberfläche, neu geschrieben
test/
  test_vault.js     230 Prüfungen
  test_dom.js       166 Prüfungen (für die neue Oberfläche neu geschrieben)
  test_browser.js   NEU: 56 Prüfungen im echten Chromium
dist/
  PasswortPeter.html, ANLEITUNG.md (für 1.0 neu geschrieben)
docs/
  HANDOVER_v0.1 … v0.4, HANDOVER_v1.0.md, TESTLISTE_v1.0.md
```

`vault.js` und `i18n.js` bleiben DOM-frei. So lassen.

---

## 9. Konventionen (unverändert, ergänzt)

- Je Version: ein Paket plus fortgeschriebenes Handover. Deutsch im Code und in
  den Dokumenten; die Oberfläche zweisprachig über `i18n.js`.
- Neuer sichtbarer Text **nur** über `t('schluessel')` und in **beiden** Sprachen
  eintragen; `build.py` fängt Vergessenes ab.
- Fragen sammeln, gebündelt stellen, dann durcharbeiten.
- Nichts behaupten, was nicht gemessen ist. In v1.0 hat genau das gefruchtet:
  der echte Browser fand zwei Layoutfehler, die jsdom nie gesehen hätte, und das
  PDF fand einen Textfehler, der seit v0.4 auf jedem Zettel stand.
