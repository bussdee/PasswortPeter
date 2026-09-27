# PasswortPeter – Handover v0.2

Stand: 18.07.2026 · Ersetzt Handover v0.1 vollständig

---

## 1. Kurzfassung für einen frischen Chat

Passwortmanager für eine dreiköpfige Familie (Vater, Mutter, Tochter).
Eine einzige HTML-Datei, 1,14 MB, läuft per Doppelklick unter `file://`.
Kein Server, keine Domain, kein Konto, kein Browser-Speicher, kein Netzzugriff.
Ein Tresor ist eine `.peter`-Datei plus ein Master-Passwort.

**Der Stand ist lauffähig und getestet, aber noch nie in einem echten Browser
gelaufen.** Siehe Abschnitt 7.

---

## 2. Die vier Entscheidungen des Nutzers

Gestellt am Ende von v0.1, beantwortet vor v0.2. Sie haben den Entwurf aus v0.1
zur Hälfte gestrichen. Wer diese Antworten nicht kennt, baut das Falsche.

| | Frage | Antwort |
|---|---|---|
| **A** | Zero-Knowledge, Wiederherstellung? | Zero-Knowledge ja. **Keine Wiederherstellung, keinerlei.** Kein Recovery-Code, keine Admin-Hintertür. |
| **B** | Was ist das „Internetarchiv"? | Kein eigenes Ding. Jede Karte ist eine Website. **Mit** Benutzer und Passwort ist sie ein Zugang, **ohne** ist sie ein Lesezeichen. Beides im selben Kasten, nach Kategorien sortiert. |
| **C** | Tochter, Alter und Rechte? | Kein Rollenmodell. Jeder legt eigene Tresore an. Der Familientresor wird als Datei weitergegeben. |
| **D** | Deploy und Domain? | **Keins von beidem.** Alles lokal im Browser, Datei per Doppelklick. |

**Was das gestrichen hat:** PHP, SQLite, libsodium serverseitig, Benutzerkonten,
X25519-Schlüsselpaare, Schlüsselversiegelung, Rollen, Sitzungen, CSRF,
Rate-Limiting, `checkup.php`. Der gesamte Serverentwurf aus v0.1 ist tot.

**Die eine ungelöste Spannung:** Antwort D („Datei per Doppelklick") und das Ziel
„die Passwörter immer parat haben, auch am Handy" beißen sich. Ohne HTTPS-Adresse
gibt es keine installierbare App, keinen Offline-Cache, und auf iOS keinen guten
Weg, eine lokale HTML-Datei zu öffnen. Der Nutzer wurde darauf hingewiesen und hat
sich trotzdem für die reine Datei entschieden. Das ist keine Nachlässigkeit,
sondern eine bewusste Wahl. Nicht ungefragt neu aufrollen.

---

## 3. Bauform

```
PasswortPeter.html   1,14 MB, eine Datei, alles inline
    ├── CSP: default-src 'none'; connect-src 'none'
    ├── <style>   style.css
    ├── <script>  libsodium-sumo.js         (WASM eingebettet, kein Nachladen)
    ├── <script>  libsodium-wrappers.js     (setzt window.sodium)
    ├── <script>  vault.js    → window.PPVault
    ├── <script>  seal.js     → window.PPSeal
    └── <script>  app.js      → window.PPApp
```

Klassische `<script>`-Tags, **keine ES-Module**: unter `file://` sind Module durch
CORS gesperrt. Die Ladereihenfolge ist zwingend, `libsodium-sumo` setzt
`window.libsodium`, die Wrapper lesen das und setzen `window.sodium`. Beide teilen
sich die Hilfsvariable `commonJsStrict`.

**Der Standard-Build von libsodium.js hat kein `crypto_pwhash`.** Nachgemessen, nicht
vermutet. Für Argon2id ist zwingend der Sumo-Build nötig. Das kostet 950 KB statt 620 KB.

---

## 4. Kryptographie

### Dateiformat `.peter`

```
Offset  Größe  Inhalt
     0      6  Magic "PPETER"
     6      1  Formatversion (1)
     7      1  KDF-Verfahren (2 = Argon2id v1.3)
     8      4  opslimit          uint32 big endian
    12      4  memlimit in KiB   uint32 big endian
    16     16  Salz
    32     24  Nonce
    56    ...  Geheimtext (XChaCha20-Poly1305, Tag inklusive)
```

Die AEAD-Zusatzdaten sind die Bytes 0..31. Damit sind Magic, Versionen,
KDF-Parameter und Salz mit authentifiziert. Ein Angreifer kann die Parameter nicht
herunterdrehen, ohne dass die Entschlüsselung auffliegt. Zusätzlich lehnt
`readHeader` Werte unter `KDF_MIN` und unsinnig hohe Werte schon vor der Ableitung ab.

### Schlüssel

```
Master-Passwort → Argon2id(salt, ops, memlimit) → 32 Byte → XChaCha20-Poly1305
```

Kein Schlüsselpaar, keine Versiegelung, kein Konto. Das folgt aus Antwort C: Ein
Tresor teilen heißt, die Datei weitergeben und das Passwort mündlich zu sagen.

**Parameter:** Vorgabe `ops=3, mem=128 MiB`. Bei Neuanlage probiert
`geraeteKdf()` einmal 128 MiB und fällt bei Fehlschlag auf `ops=4, mem=48 MiB`
zurück. Die Werte stehen im Dateikopf, also kann jedes Gerät jeden Tresor öffnen,
egal womit er angelegt wurde.

**Warum so hoch:** Ohne Server gibt es keine Anmeldesperre und kein Rate-Limiting.
Wer die Datei hat, kann offline raten, so oft er will. Die Schlüsselableitung ist
die einzige Bremse. Deshalb ist sie absichtlich teuer.

### Nonce

24 Byte, bei jedem Speichern neu gewürfelt. Genau dafür ist XChaCha20 da: bei
24 Byte ist ein Zufallsnonce sicher, bei den 12 Byte von AES-GCM wäre es das nicht.
Nachgemessen: 30 Speicherungen ergeben 30 verschiedene Salze und 30 verschiedene Noncen.

### Keine Wiederherstellung

Bewusst. Es gibt keinen Code, keine Frage, keine Hintertür, niemanden, der
gezwungen werden könnte. Der Preis steht im Programm selbst, im Fettdruck, beim
Anlegen jedes Tresors.

---

## 5. Gemessene Werte

Nichts hiervon ist geschätzt.

| Was | Wert |
|---|---|
| Argon2id im WASM, 64 MiB / t=3 | 538 ms |
| Argon2id im WASM, **128 MiB / t=3** (Vorgabe) | **881 ms** |
| Argon2id im WASM, 256 MiB / t=3 | 1891 ms |
| Argon2id im WASM, 512 MiB / t=3 | 3973 ms |
| Start von libsodium in jsdom | 49 ms |
| Tresor mit 500 Einträgen, verschlüsselt | 111 KB |
| Fertige HTML-Datei | 1,14 MB |

Auf einem älteren Handy ist mit dem Drei- bis Fünffachen zu rechnen. 128 MiB ist
damit die Obergrenze des Zumutbaren.

---

## 6. Was v0.2 kann

- Tresor anlegen, öffnen (Dateidialog oder Ziehen und Ablegen), aufsperren, zusperren
- Karten anlegen, ändern, löschen. Felder: Titel, Adresse, Reiter, Benutzer, Passwort, Notiz, Favorit
- Karte ohne Benutzer und Passwort ist ein Lesezeichen (Antwort B)
- Reiter (Kategorien) anlegen, umbenennen, einfärben, löschen. Acht Farben.
- Suche über Titel, Adresse, Benutzer, Notiz
- Website öffnen. **Nur `http` und `https`**, alles andere wird verworfen und bekommt keinen Knopf.
- Passwort kopieren, Zwischenablage löscht sich nach 20 s. Rückfall auf `execCommand`, falls `navigator.clipboard` unter `file://` streikt.
- Passwortgenerator, gleichverteilt ohne Modulo-Schiefstand, ohne `l I O 0 1`
- Stärkeanzeige in Bit
- Speichern als Download
- Autosperre nach 5 min. Bei ungespeicherten Änderungen erst ein Countdown über 90 s.
- Warnung beim Schließen des Fensters, wenn ungespeichert
- `Strg+S`, `Strg+L`, `Esc`

### Siegel statt Favicons

Jede Seite bekommt ein selbst gerechnetes Erkennungszeichen: BLAKE2b über den
Domainnamen, daraus Farbton, Kranzmuster und Anfangsbuchstabe.

**Favicons wären ein Bruch des ganzen Versprechens.** Sie nachzuladen würde einem
fremden Server mitteilen, welche Seiten im Tresor liegen. Deshalb gibt es sie nicht
und wird es sie nie geben. Wer das später „verbessern" will, hat den Punkt nicht verstanden.

### Gestaltung

Bild: ein Karteikasten. Karten mit farbigem Reiter am linken Rand, dunkler
geschlossener Kasten beim Sperren, helles Papier beim Arbeiten.
Systemschrift für Fließtext, **dickengleiche Schrift für alle Zugangsdaten**,
damit 0 und O sowie 1, l und I unterscheidbar bleiben, wenn man ein Passwort
vorliest. Keine Webfonts, keine externen Bilder, nichts, was nachgeladen werden müsste.

---

## 7. Was v0.2 nicht kann, und was daran weh tut

**Nie in einem echten Browser gelaufen.** Playwright und Chromium sind im
Bau-Container durch die Netzsperre blockiert. Getestet wurde in jsdom, und jsdom
ist kein Browser. Ungeprüft und in dieser Reihenfolge riskant:

1. **Die CSP.** `wasm-unsafe-eval` sollte libsodiums WebAssembly erlauben. Wenn die
   Datei gar nicht startet, ist die `<meta http-equiv="Content-Security-Policy">`-Zeile
   der erste Verdacht. Sie ist einzeln entfernbar, der Kommentar darüber sagt das auch.
2. **Zwischenablage unter `file://`.** `navigator.clipboard` braucht einen sicheren
   Kontext. Chrome und Firefox behandeln `file://` als solchen, Safari ist unklar.
   Der `execCommand`-Rückfall ist eingebaut, aber ungeprüft.
3. **Download unter `file://`,** besonders auf iOS Safari.
4. **`window.open`** aus einer `file://`-Seite auf eine `https://`-Seite.

**Speichern ist ein Download.** Jedes Mal. Die Datei landet bei den Downloads und
muss von Hand an ihren Platz zurück. Nach dem zehnten Mal heißt sie
`Familie (10).peter`. Die File System Access API würde das lösen, aber sie ist für
uns tot: Firefox unterstützt die Picker in keiner Version, Safari auf macOS und iOS
ebenfalls nicht, kein mobiler Browser hat sie, und sie verlangt einen sicheren
Kontext. **Das ist der größte Schmerzpunkt und der beste Kandidat für v0.3.**

**Am Handy ist die Bedienung mühsam bis unmöglich.** Siehe die Spannung in Abschnitt 2.

**Zwei Kopien laufen auseinander.** Wer den Familientresor weitergibt, hat zwei
Dateien. Es gibt kein Zusammenführen. Zuletzt gespeichert gewinnt, der Rest ist weg.

**Nicht eingebaut:** TOTP, Import aus anderen Managern, Export als CSV, Passwort
ändern für einen bestehenden Tresor, Chronik, Papierkorb, Sortieren der Reiter
per Ziehen.

---

## 8. Bauen und Prüfen

```bash
# PHP fehlt im Container, wird hier aber nicht mehr gebraucht.
cd lib
npm install libsodium-wrappers-sumo@0.7.15 jsdom@25.0.1

cd ../pp
node test/test_vault.js     # 74 Prüfungen des Kerns, ohne DOM
python3 build.py            # baut dist/PasswortPeter.html und prüft sie
node test/test_dom.js       # 47 Prüfungen an der fertigen Datei in jsdom
```

`build.py` bricht ab, wenn ein Teil `</script>` enthält, wenn ein Platzhalter
stehen bleibt, wenn eine externe Quelle eingebunden ist, wenn der eigene Code
`fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `localStorage`, `sessionStorage`
oder `indexedDB` benutzt, oder wenn `connect-src 'none'` aus der CSP verschwindet.

`test_dom.js` nagelt `fetch`, `XMLHttpRequest`, `WebSocket` und `sendBeacon` zu und
protokolliert jeden Versuch. Der Durchlauf endet mit **null** Netzversuchen. Das ist
der Nachweis, dass die eingebettete Datei nichts nachlädt, und nicht bloß eine Behauptung.

**Zwei Fehler, die diese Tests gefunden haben und die man sonst erst beim Nutzer merkt:**

- `utf8Encode` griff im Rückfall nach Nodes `Buffer`. In Node lief das durch, im
  Browser wäre es abgestürzt. Jetzt kodiert `vault.js` UTF-8 selbst und wird gegen
  `TextEncoder` verglichen, inklusive Emoji und einsamer Ersatzhälften.
- Die Bauprüfung schlug bei `@@` und `<script>` Alarm. Beides steckt in libsodiums
  eingebetteten Daten. Die Prüfungen sind jetzt gezielt, nicht blind.

---

## 9. Dateien

```
pp/
  build.py              Bau und Selbstprüfung
  src/
    shell.html          Gerüst mit CSP und Platzhaltern
    style.css           Karteikasten
    vault.js            Format, Krypto, Datenmodell, Generator, Suche. Kein DOM.
    seal.js             Siegel aus BLAKE2b
    app.js              Bildschirme, Kartei, Blatt, Speichern, Autosperre
  test/
    test_vault.js       74 Prüfungen
    test_dom.js         47 Prüfungen an der gebauten Datei
  dist/
    PasswortPeter.html  das Ergebnis
    ANLEITUNG.md        für Frau und Tochter
```

`vault.js` ist bewusst frei von DOM, damit es in Node hart geprüft werden kann.
So bleiben.

---

## 10. Roadmap

| Version | Inhalt |
|---|---|
| ~~v0.1~~ | ~~Server-Check~~ hinfällig durch Antwort D |
| **v0.2** | **Erste lauffähige Fassung. Hier.** |
| v0.3 | Rückmeldung aus echten Browsern einarbeiten. Danach: das Speicherproblem entschärfen. |
| v0.4 | Passwort eines Tresors ändern, Papierkorb, Reiter sortieren |
| v0.5 | Import aus Browser-Lesezeichen und aus anderen Managern |
| v0.6 | Zusammenführen zweier Kopien desselben Tresors, per Eintrag nach Zeitstempel |
| v0.7 | TOTP |
| v1.0 | Härtung, Notfallzettel für die Familie |

**v0.3 beginnt nicht, bevor der Nutzer die Datei in seinen echten Browsern
geöffnet hat.** Alles andere wäre Bauen ins Blaue.

---

## 11. Konventionen

- Je Version: ein Paket zum Verteilen und ein fortgeschriebenes Handover.
- Sprache im Programm und in der Doku: Deutsch.
- Keine Frameworks, keine CDNs, keine Tracker, kein Netzzugriff zur Laufzeit.
- Der Nutzer will keine Rückfragen mitten in der Arbeit. Fragen sammeln, gebündelt
  stellen, danach durcharbeiten.
- Nichts behaupten, was nicht gemessen ist. Diese Zusammenarbeit hat bisher drei
  Annahmen widerlegt: der Standard-Build von libsodium kann kein Argon2id, die File
  System Access API ist unbrauchbar, und `Buffer` gibt es im Browser nicht. Alle drei
  wären ohne Prüfung als Fakt in den Code gewandert.
