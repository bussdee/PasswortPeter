# PasswortPeter 1.0 – Testliste für echte Geräte

Die automatischen Tests laufen in Chromium. Diese Liste ist für das, was nur auf
euren echten Geräten zu sehen ist. Am besten mit einem **Test-Tresor** (neu
anlegen, Passwort wie `Test-Tresor-2026-Probe`), nicht mit dem echten.

Abhaken, was klappt; bei Problemen kurz notieren: Gerät, Browser, was passiert ist.

## 1. Start (jedes Gerät)

- [ ] `PasswortPeter.html` per Doppelklick öffnen: Startschirm mit Logo, „v1.0.0“ unten.
- [ ] **DE / EN** oben rechts schaltet die Sprache um.
- [ ] Neuen Test-Tresor anlegen, „Merksatz vorschlagen“ ausprobieren.
- [ ] Die `.peter`-Datei wird gespeichert (Chrome/Edge: Speicherort wählen;
      Firefox/Handy: landet bei den Downloads).

## 2. Karten und Favoriten

- [ ] Eine Karte mit Benutzer und Passwort anlegen, eine nur mit Adresse (Lesezeichen).
- [ ] Emoji und Farbe vergeben, als Favorit markieren → erscheint groß in der Übersicht.
- [ ] Zweite Adresse, ein Schlagwort und ein verborgenes Feld „PIN“ eintragen.
- [ ] Suche nach dem Schlagwort mit `#` findet die Karte; Suche nach der PIN findet sie **nicht**.
- [ ] Kacheln ↔ Liste umschalten.
- [ ] Sortierung auf „Eigene Reihenfolge“, eine Karte verschieben (Maus bzw. Pfeile).

## 3. Kopieren und Öffnen (wichtig auf jedem Browser)

- [ ] Schlüssel-Knopf: Passwort woanders einfügen → stimmt.
- [ ] Nach 20 Sekunden ist die Zwischenablage leer.
- [ ] Pfeil-Knopf öffnet die Website in einem neuen Tab.

## 4. Speichern und wieder öffnen

- [ ] Speichern, Fenster schließen, `PasswortPeter.html` neu öffnen, Datei laden.
- [ ] Falsches Passwort → Fehlermeldung. Richtiges → alle Karten wieder da,
      mit Emoji, Schlagwort, PIN und Reihenfolge.
- [ ] Chrome/Edge: zweites Speichern überschreibt dieselbe Datei (keine „(1)“-Kopie).

## 5. Sicherheit

- [ ] Einer Karte ein neues Passwort geben → im Detail „Frühere Passwörter (1)“.
- [ ] Zwei Karten mit gleichem Passwort → Sicherheit zeigt „Mehrfach benutzt“.
- [ ] Menü → Sicherungskopie herunterladen → Datei mit Datum im Namen; lässt sich öffnen.

## 6. Notfallzettel (bitte einmal wirklich auf Papier)

- [ ] Menü → Notfallzettel drucken → Vorschau zeigt **nur** den Zettel.
- [ ] Auf dem Zettel steht **kein** Passwort, das Feld zum Eintragen ist da.
- [ ] Strg+P im normalen Tresor druckt nur „PasswortPeter druckt keine Tresore.“

## 7. Handy (iPhone/Android)

- [ ] ☰ öffnet die Navigation, Auswahl schließt sie wieder.
- [ ] Nichts ragt seitlich über den Rand, nirgends seitliches Wischen nötig.
- [ ] Karte antippen → Blatt kommt von unten, alle Knöpfe erreichbar.
- [ ] Kopieren des Passworts funktioniert (besonders iOS Safari prüfen).
- [ ] Speichern lädt die Datei herunter und sie lässt sich wieder öffnen.

## 8. Aussehen

- [ ] System auf dunkel → Peter wird dunkel. Einstellungen → „Hell“ erzwingt hell.
- [ ] Einstellungen → Sprache English → alles englisch, bleibt nach Speichern und Neuöffnen.

## 9. Lesezeichen in den Browser

- [ ] Menü → Lesezeichen exportieren → in Firefox oder Chrome importieren:
      Reiter sind Ordner, **keine** Passwörter in der Datei.

## 10. Ältere Version

- [ ] Einen alten v0.4-Tresor in 1.0 öffnen → alle Karten da.
- [ ] Danach auf allen Geräten nur noch 1.0 benutzen (v0.4 würde die neuen Angaben beim Speichern verlieren).
