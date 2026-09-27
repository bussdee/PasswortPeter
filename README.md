# PasswortPeter

Ein Passwortmanager und Lesezeichen-Tresor für die Familie, als eine einzige
HTML-Datei. Kein Server, kein Konto, kein Browser-Speicher, kein Netzzugriff. Ein
Tresor ist eine `.peter`-Datei plus ein Master-Passwort, mehr nicht.

Version 1.0: neue Oberfläche (hell und dunkel, Handy), Favoriten als Startseite,
Schlagwörter, mehrere Adressen und Zusatzfelder je Karte, Passwortverlauf,
Sicherheitsübersicht, Sicherungskopie, Lesezeichen-Export, Deutsch und Englisch.

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
  style.css    Gestaltung (hell, dunkel, Handy, Druck)
  i18n.js      Texte auf Deutsch und Englisch. Kein DOM.
  vault.js     Dateiformat, Kryptographie, Datenmodell. Kein DOM, daher in Node testbar.
  seal.js      Erkennungszeichen für Webseiten, offline aus einem Hash erzeugt
  app.js       Bildschirme und Bedienung
build.py       Fügt alles zu einer einzigen HTML-Datei zusammen und prüft sie
test/
  test_vault.js   Prüfungen des Kerns, ohne Browser
  test_dom.js     Prüfungen der fertig gebauten Datei in einer Browser-Umgebung (jsdom)
  test_browser.js Prüfungen im echten Chromium (Playwright), inkl. Handy und Druckbild
dist/
  PasswortPeter.html   das Ergebnis, zum Verteilen
  ANLEITUNG.md         für die Familie
docs/
  HANDOVER_v*.md       Entwicklungsstand und Entscheidungen je Version
  TESTLISTE_v1.0.md    was auf echten Geräten von Hand zu prüfen ist
```

## Bauen und testen

```bash
npm install
npm run verify
```

`npm run verify` führt nacheinander aus: die Kernprüfungen, den Bau der
Einzeldatei, die Prüfungen an der fertig gebauten Datei in jsdom und im echten
Chromium. `build.py` bricht ab, wenn eine externe Quelle eingebunden wäre, wenn
eigener Code Netzfunktionen oder Browser-Speicher benutzt, wenn die
Sicherheitsrichtlinie (`connect-src 'none'`) fehlt, wenn ein Text nicht in beiden
Sprachen steht oder die Versionsnummern auseinanderlaufen.

Fehlt ein Chromium für Playwright: einmal `npx playwright install chromium`.

## Wichtig für alle, die hier mitarbeiten

- Niemals eine echte `.peter`-Datei oder einen Klartext-Export in dieses
  Repository legen. Die `.gitignore` schützt davor, ersetzt aber keine Vorsicht.
- Keine Frameworks, keine CDNs, kein Netzzugriff zur Laufzeit. Das ist keine
  Stilfrage, sondern der Kern des Sicherheitsversprechens.
- `vault.js` und `i18n.js` bleiben frei von DOM-Zugriffen, damit sie in Node hart
  geprüft werden können.
- Sichtbarer Text nur über `t('schluessel')` aus `src/i18n.js`, immer in beiden Sprachen.
- Vor jeder Änderung an der Kryptographie oder dem Dateiformat: `docs/HANDOVER_v0.1.md`
  und `docs/HANDOVER_v0.2.md` lesen. Dort stehen die Gründe für die Entscheidungen.

## Stand

Version 1.0.0. Geprüft in Node, in jsdom und erstmals im echten Chromium
(Desktop, Handy-Größe, Druckbild des Notfallzettels). Noch nicht auf echten
Firefox- und iOS-Geräten; dafür gibt es `docs/TESTLISTE_v1.0.md`. Details,
gemessene Werte und offene Punkte in `docs/HANDOVER_v1.0.md`.
