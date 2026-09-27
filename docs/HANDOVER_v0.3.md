# PasswortPeter – Handover v0.3

Stand: 20.07.2026 · Ersetzt Handover v0.2 vollständig

---

## 1. Kurzfassung für einen frischen Chat

Passwortmanager für eine dreiköpfige Familie. Eine einzige HTML-Datei, **1,18 MB**,
läuft per Doppelklick unter `file://`. Kein Server, kein Konto, kein
Browser-Speicher, kein Netzzugriff. Ein Tresor ist eine `.peter`-Datei plus ein
Master-Passwort.

**Getestet, aber weiterhin nie in einem echten Browser gelaufen** (jsdom ist kein
Browser, Playwright/Chromium sind im Container gesperrt). Prüfstand: **132 Kerntests
plus 75 Tests an der gebauten Datei, alle grün.** Der DOM-Testlauf endet mit null
Netzversuchen.

Die vier Grundentscheidungen aus v0.2 gelten unverändert: Zero-Knowledge, **keine
Wiederherstellung**, jede Website ist eine Karte (mit Zugang oder als Lesezeichen),
Datei per Doppelklick statt Server. Details dazu in der Handover-Historie; hier steht,
was v0.3 hinzufügt.

---

## 2. Was v0.3 neu bringt

Der Nutzer hat vier Wünsche priorisiert (Kassensturz, Import, Papierkorb,
Master-Passwort ändern) und beim Speichern „pro Tresor eine Datei, immer wieder
überschreiben" gewählt. TOTP wurde bewusst nicht gewählt und ist nicht gebaut.

### Speichern in dieselbe Datei (File System Access)

Der größte Schmerzpunkt aus v0.2 ist entschärft. Kann der Browser die File System
Access API (`showSaveFilePicker` / `showOpenFilePicker`), wird beim ersten Speichern
einmal nach dem Ort gefragt und danach immer genau diese Datei überschrieben. Kein
`Familie (10).peter` mehr.

**Belegte Fakten, nicht vermutet:** Die Secure-Contexts-Spezifikation sagt, dass
`file://` als potentially trustworthy behandelt werden **soll** ("should", nicht
"must"). Deshalb wird alles per `KANN_UEBERSCHREIBEN` / `KANN_OEFFNEN_MIT_HANDLE`
feature-detektiert und fällt sauber zurück:

- Chrome, Edge, Opera am Rechner: überschreiben.
- Firefox, Safari, praktisch alle Handys: Download wie in v0.2.
- Schlägt ein Schreibversuch fehl, fällt `speichern()` selbsttätig auf den Download
  zurück. Lieber ein Download zu viel als eine verlorene Änderung.

`speichern()` ist dadurch **async** geworden. Alle Aufrufer wurden angepasst
(`.then(...)` statt `if (speichern())`). Das Handle sitzt in `Z.dateiHandle`, wird
nur über den Dateiwähler gesetzt (nicht über Ziehen-und-Ablegen, das liefert keins)
und beim Zusperren gelöscht.

Getestet mit einem gefälschten Handle in jsdom: die Bytes landen im Handle, es
kommt **kein** Download, und die geschriebenen Bytes sind ein gültiger Tresor.

### Kassensturz (`V.audit`)

Prüft die Passwörter gegen sich selbst: mehrfach benutzte (gruppiert) und
rechnerisch schwache (`ratePassword`-Stufe ≤ 1). **Kein** Abgleich mit Leck-Listen,
denn das bräuchte Netz. Gibt eine Note in Prozent (Anteil unbelasteter Passwörter),
ignoriert den Papierkorb. Die Oberfläche führt per Klick auf eine Zeile direkt in
den Bearbeiten-Dialog der betroffenen Karte. Ein roter Zähler am Werkzeug zeigt die
Zahl der Baustellen, ein grüner Haken heißt sauber.

### Import (`V.importCsv`, `V.importBookmarks`, `V.mergeImport`)

- **CSV** von Bitwarden, KeePass, Chrome, Firefox und generisch. Trennzeichen
  (Komma oder Semikolon) wird geraten, RFC-4180-Anführungszeichen und Umbrüche im
  Feld werden korrekt gelesen, BOM abgeschnitten. Spalten werden über Namenslisten
  erkannt; fehlt eine Kopfzeile, gilt die Reihenfolge Titel, Adresse, Benutzer,
  Passwort, Notiz. Ordner werden zu Reitern.
- **Lesezeichen** aus dem Netscape-HTML-Export jedes Browsers. Mit einfachen Mustern
  statt DOM-Parser, damit es in Node prüfbar ist. `javascript:` und andere unsichere
  Adressen fliegen raus.
- **`mergeImport`** überspringt Dubletten (gleicher Host + gleicher Benutzer) und
  verwendet vorhandene Kategorien wieder.

Ein echter Bug wurde hier gefunden und behoben: Bitwarden exportiert
`login_username` / `login_password`, was die erste Spaltenliste nicht erkannte. Das
ist genau die Art Fehler, die nur am echten Exportformat auffällt.

### Papierkorb (Soft-Delete)

Items haben jetzt `deletedAt`. Löschen setzt nur dieses Feld (kein Nachfragen mehr,
stattdessen ein „Zurückholen"-Zuruf für 6 Sekunden). `V.trashList`, `V.liveCount`,
und `V.search` überspringen Gelöschtes. Eine eigene Papierkorb-Ansicht erlaubt
Zurückholen oder endgültiges Entfernen; „Papierkorb leeren" fragt einmal nach.

### Master-Passwort ändern

Im Menü (···). Verlangt das jetzige Passwort zur Sicherheit, prüft Stärke, setzt
`Z.passwort` und würfelt `Z.kdf` neu, speichert. Ein Test beweist: der neu
verschlüsselte Tresor öffnet sich nur noch mit dem neuen Passwort. Kein neuer
Krypto-Code nötig, `encrypt` erledigt das.

### Kleinigkeiten

Benutzer direkt von der Karte kopierbar; `usedAt` wird beim Öffnen/Kopieren gesetzt
(löst bewusst kein „ungespeichert" aus); Sortierung A–Z / zuletzt benutzt / neueste;
`/` und `Strg`+`K` springen ins Suchfeld; CSV-Export als Notausgang mit deutlicher
Klartext-Warnung.

---

## 3. Datenmodell-Änderungen gegenüber v0.2

`newItem` und `sanitize` haben zwei neue Felder, **abwärtskompatibel**: alte
v0.2-Dateien ohne diese Felder werden beim Öffnen ergänzt.

```
items:  … , usedAt (string|null), deletedAt (string|null)
```

`search(data, query, catId, onlyFav, sortMode)` hat einen fünften Parameter
(`'name'` | `'benutzt'` | `'neu'`). Neue Kernfunktionen: `sortieren`, `trashList`,
`liveCount`, `audit`, `parseCsv`, `importCsv`, `importBookmarks`, `mergeImport`,
`exportCsv`.

Das Dateiformat `.peter` (Magic, Header, XChaCha20-Poly1305, Argon2id-Parameter im
Kopf) ist **unverändert**. Ein v0.3-Tresor öffnet sich in v0.2 und umgekehrt, solange
die neuen Felder ignoriert werden. Die Kryptografie wurde nicht angefasst.

---

## 4. Gemessene Werte

| Was | Wert |
|---|---|
| Fertige HTML-Datei | 1,18 MB |
| Tresor mit 500 Einträgen, verschlüsselt | 126 KB (v0.2: 111 KB, +2 Felder/Eintrag) |
| Kerntests | 132, grün |
| DOM-Tests an der gebauten Datei | 75, grün |
| Netzversuche im DOM-Testlauf | 0 |

Die Argon2id-Zeiten aus v0.2 gelten unverändert (128 MiB / t=3 ≈ 0,9 s am Rechner).

---

## 5. Was weiterhin offen ist

**Immer noch nie in einem echten Browser gelaufen.** Das ist die wichtigste
Einschränkung. Konkret ungeprüft und nach Risiko geordnet:

1. **File System Access unter `file://`.** Die Spec sagt „should", nicht „must".
   Wenn `showSaveFilePicker` auf `file://` doch blockiert ist, greift der
   Download-Fallback — das ist ungeprüft, aber so gebaut, dass es nicht schlimmer
   als v0.2 wird.
2. **Die CSP-Zeile** (unverändert aus v0.2). Erster Verdacht, falls gar nichts
   startet; einzeln entfernbar, Kommentar im HTML sagt das.
3. **Zwischenablage und Download unter `file://`**, besonders iOS Safari.
4. **`showOpenFilePicker`-Dialog** auf den verschiedenen Systemen.

**v0.4 beginnt erst, wenn der Nutzer die Datei in seinen echten Browsern getestet
hat.** Das steht seit v0.2 so und gilt weiter. Vorher ist alles Bauen ins Blaue.

Nicht gebaut (bewusst): TOTP (nicht gewählt), Zusammenführen zweier auseinander
gelaufener Kopien, Reiter per Ziehen sortieren.

---

## 6. Bauen und Prüfen

```bash
cd lib && npm install libsodium-wrappers-sumo@0.7.15 jsdom@25.0.1
cd ../pp
node test/test_vault.js     # 132 Kernprüfungen, ohne DOM
python3 build.py            # baut dist/PasswortPeter.html und prüft sie
node test/test_dom.js       # 75 Prüfungen an der fertigen Datei in jsdom
```

`build.py` bricht ab bei `</script>` im Code, stehengebliebenen Platzhaltern,
externen Quellen, `fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`/Storage im
eigenen Code, oder wenn `connect-src 'none'` aus der CSP verschwindet.

`test_dom.js` nagelt alle Netzwege zu und protokolliert jeden Versuch; der Lauf
endet mit null. Ein Realm-Fallstrick, den dieser Test gefunden hat: jsdom hat ein
eigenes `Uint8Array`, ein `instanceof Uint8Array` aus Node schlägt fehl. Im Test
gegen `w.Uint8Array` prüfen. Kein App-Fehler, ein Testartefakt.

---

## 7. Dateien

```
pp/
  build.py
  src/
    shell.html   Gerüst mit CSP, Leiste (jetzt mit Sortier- und Menü-Knopf), Platzhaltern
    style.css    Karteikasten + v0.3-Block (Kassensturz, Import, Papierkorb, Menü)
    vault.js     Format, Krypto, Modell, Generator, Suche, + audit/import/export/trash. Kein DOM.
    seal.js      Siegel aus BLAKE2b
    app.js       Bildschirme; speichern() jetzt async mit Datei-Handle
    vault.js.v02, app.js.v02   Sicherungen des v0.2-Stands
  test/
    test_vault.js   132 Prüfungen
    test_dom.js     75 Prüfungen an der gebauten Datei
  dist/
    PasswortPeter.html   das Ergebnis
    ANLEITUNG.md         für Frau und Tochter, mit v0.3-Abschnitt
    HANDOVER_v0.3.md     diese Datei
```

`vault.js` bleibt bewusst DOM-frei, damit es in Node hart prüfbar ist. So lassen.

---

## 8. Konventionen (unverändert)

- Je Version: ein Paket zum Verteilen und ein fortgeschriebenes Handover.
- Deutsch. Keine Frameworks, keine CDNs, kein Netzzugriff zur Laufzeit.
- Fragen sammeln, gebündelt stellen, dann durcharbeiten.
- Nichts behaupten, was nicht gemessen ist. v0.3 hat wieder zwei Dinge korrigiert,
  die ungeprüft als Fakt durchgegangen wären: Bitwardens Spaltennamen und der
  Realm-Unterschied bei `Uint8Array`. Die Testdisziplin bleibt der Grund, warum
  das Ding trotz fehlendem echten Browser tragfähig ist.
```
