# PasswortPeter

Ein Passwortmanager für die Familie, als eine einzige HTML-Datei. Kein Server, kein
Konto, kein Browser-Speicher, kein Netzzugriff. Ein Tresor ist eine `.peter`-Datei
plus ein Master-Passwort, mehr nicht.

**Dieses Repository enthält nur den Quellcode.** Es ist reine Versionsverwaltung und
Sicherung, kein Hosting und kein Server für die Anwendung selbst. Wer PasswortPeter
benutzt, lädt `dist/PasswortPeter.html` herunter und öffnet sie per Doppelklick.

## Warum ohne Server

Die Anwendung verschlüsselt alles im Browser (Argon2id, XChaCha20-Poly1305), bevor
irgendetwas gespeichert wird. Es gibt bewusst **keine Wiederherstellung**: kein
Zurücksetzen, keine Notfallfrage, keine Hintertür. Details und die Begründung dazu
stehen in `docs/HANDOVER_v0.1.md`.

## Aufbau

```
src/
  shell.html   HTML-Gerüst mit Content-Security-Policy
  style.css    Gestaltung
  vault.js     Dateiformat, Kryptographie, Datenmodell. Kein DOM, daher in Node testbar.
  seal.js      Erkennungszeichen für Webseiten, offline aus einem Hash erzeugt
  app.js       Bildschirme und Bedienung
build.py       Fügt alles zu einer einzigen HTML-Datei zusammen und prüft sie
test/
  test_vault.js   Prüfungen des Kerns, ohne Browser
  test_dom.js     Prüfungen der fertig gebauten Datei in einer Browser-Umgebung
dist/
  PasswortPeter.html   das Ergebnis, zum Verteilen
  ANLEITUNG.md         für die Familie
docs/
  HANDOVER_v0.*.md     Entwicklungsstand und Entscheidungen je Version
```

## Bauen und testen

```bash
npm install
npm run verify
```

`npm run verify` führt nacheinander aus: die Kernprüfungen, den Bau der
Einzeldatei, und die Prüfungen an der fertig gebauten Datei. `build.py` bricht
ab, wenn eine externe Quelle eingebunden wäre, wenn eigener Code Netzfunktionen
oder Browser-Speicher benutzt, oder wenn die Sicherheitsrichtlinie
(`connect-src 'none'`) fehlt.

## Wichtig für alle, die hier mitarbeiten

- Niemals eine echte `.peter`-Datei oder einen Klartext-Export in dieses
  Repository legen. Die `.gitignore` schützt davor, ersetzt aber keine Vorsicht.
- Keine Frameworks, keine CDNs, kein Netzzugriff zur Laufzeit. Das ist keine
  Stilfrage, sondern der Kern des Sicherheitsversprechens.
- `vault.js` bleibt frei von DOM-Zugriffen, damit es in Node hart geprüft werden kann.
- Vor jeder Änderung an der Kryptographie oder dem Dateiformat: `docs/HANDOVER_v0.1.md`
  und `docs/HANDOVER_v0.2.md` lesen. Dort stehen die Gründe für die Entscheidungen.

## Stand

Version 0.4. Bislang in keinem echten Browser getestet, nur in Node und einer
simulierten Browser-Umgebung (jsdom). Details, gemessene Werte und offene Punkte in
`docs/HANDOVER_v0.4.md`.
