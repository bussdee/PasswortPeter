# PasswortPeter – Handover v0.1

Stand: 16.07.2026 · Vorgänger: `Handover_v0.zip`

---

## 1. Worum es geht

Ein Passwortmanager für eine dreiköpfige Familie (Vater, Mutter, Tochter), betrieben auf dem
eigenen Webserver. Kein Cloud-Dienst, keine Abhängigkeit von einem Anbieter. Zusätzlich soll
eine Funktion namens „Internetarchiv" dazukommen (siehe offene Frage B).

Drei Ziele, in dieser Reihenfolge: **sicher**, **simpel**, **schön**.

**Beteiligte**
| Person | Rolle | Anmerkung |
|---|---|---|
| Vater | Betreiber, Admin, mein Gegenüber im Chat | |
| Mutter | Vollnutzerin | |
| Tochter | Nutzerin | Alter und Rechte noch offen, siehe Frage C |

---

## 2. Was im Handover v0 stand

Fünf Dateien mit zusammen sieben Zeilen. Kein Code, kein Schema, keine getroffenen
Entscheidungen. Das Projekt beginnt bei null. Der gesamte Inhalt:

- **Ziel:** sicherer Passwortmanager plus Internetarchiv
- **Leitbild:** website-zentriert, mehrere Tresore
- **Technik:** PHP 8, SQLite, libsodium, keine Frameworks
- **Sicherheit:** Argon2id, XChaCha20-Poly1305, verschlüsselte Exporte, CSRF, Prepared Statements
- **Reihenfolge:** Architektur → UI → Datenmodell → Kryptographie → Kernfunktionen → Sync → Tests

Die Vorgaben sind übernommen. Eine Abweichung schlage ich vor: die Kryptographie wandert
in der Reihenfolge nach vorne, weil das Datenmodell davon abhängt und nicht umgekehrt.

---

## 3. Stand v0.1

Ausgeliefert: `checkup.php`. Ein Diagnoseskript, das der Betreiber einmal hochlädt, im Browser
aufruft und dessen JSON-Ausgabe er zurück in den Chat kopiert. Danach löscht er die Datei.

Es prüft PHP-Version, libsodium samt aller benötigten Funktionen, SQLite mit WAL-Modus und
Schreibtest, Argon2id mit Zeitmessung, HTTPS, Schreibrechte oberhalb des Webroots, sowie die
relevanten php.ini-Werte.

Getestet im Container gegen PHP 8.3.6, libsodium 1.0.18, SQLite 3.45.1: läuft ohne Warnung,
räumt seinen Testordner selbst wieder weg.

**Ergebnis vom echten Server steht aus.** Ohne das kann v0.2 nicht beginnen.

---

## 4. Architekturvorschlag

> Der ganze Abschnitt 4 ist **Vorschlag, nicht Beschluss**. Er hängt an Frage A.

### 4.1 Kryptographie: Zero-Knowledge im Browser

Der Server bekommt niemals Klartext zu sehen. Ver- und Entschlüsselt wird im Browser mit
libsodium.js (WASM, lokal ausgeliefert, kein CDN). Der Server ist eine dumme Ablage für
Geheimtext plus die Rechteverwaltung.

**Pro Person**

```
Master-Passwort  (nur im Kopf)
        │
        ├─ Argon2id(pw, salt_u, m=64 MiB, t=3, p=1) → 64 Byte
        │        ├─ Byte  0..31 → KEK      bleibt im Browser, verlässt ihn nie
        │        └─ Byte 32..63 → authSecret   geht an den Server
        │
Server speichert:  password_hash(authSecret, ARGON2ID)   ← daraus folgt kein KEK
```

Jede Person hat ein X25519-Schlüsselpaar.
`pubKey` liegt im Klartext auf dem Server, `privKey` nur als `crypto_secretbox(privKey, KEK)`.

**Pro Tresor**

```
VK = 32 zufällige Byte
   └─ für jedes Mitglied:  crypto_box_seal(VK, pubKey_mitglied)  → Zeile in vault_members

Eintrag:  crypto_aead_xchacha20poly1305_ietf_encrypt(JSON, VK, nonce, ad = item_id|rev)
```

Einen Tresor teilen heißt dann: eine Zeile mit einem versiegelten `VK` anlegen. Zugriff
entziehen heißt: Zeile löschen, `VK` neu würfeln, Einträge neu verschlüsseln.

**Wiederherstellung.** Ohne Master-Passwort sind die Daten sonst weg, deshalb zwingend:

1. Beim Anlegen des Kontos werden 32 Zufallsbytes zu einem Wiederherstellungscode. Daraus
   entsteht `RK`, damit liegt eine zweite Hülle um `privKey`. Der Code wird einmal angezeigt,
   zum Ausdrucken. Er landet nie auf dem Server.
2. Optional zusätzlich: `privKey` auch an einen Admin-Wiederherstellungsschlüssel gesiegelt.
   Für ein Kind, das sein Passwort vergisst, ist das praktisch. Für Erwachsene ist es eine
   bewusste Hintertür. Gehört in Frage A entschieden.

**Was der Server trotzdem sieht:** Benutzername, Anmeldezeiten, wie viele Einträge in welchem
Tresor liegen, wer mit wem teilt, die Größe der Blobs. Metadaten lassen sich hier nicht
vollständig verstecken, und das ist für eine Familie auf eigenem Server auch in Ordnung.

**Folge für die Suche:** Suchen im Server geht nicht, weil dort nichts lesbar ist. Der Browser
entschlüsselt beim Entsperren den ganzen Tresor in den Arbeitsspeicher und sucht dort. Bei
einigen hundert Einträgen ist das schnell.

**Folge für die Wahl von libsodium.js:** Argon2id kennt die WebCrypto-API nicht. Deshalb WASM.
Das kostet etwa 300 KB beim ersten Laden, danach liegt es im Cache.

### 4.2 Datenmodell (Entwurf, SQLite)

```
users          id, username, salt_u, auth_hash, pubkey,
               privkey_enc, privkey_recovery_enc, privkey_escrow_enc,
               role, created_at, last_login_at, failed_logins, locked_until
vaults         id, owner_id, created_at
vault_members  vault_id, user_id, vk_sealed, name_enc, role, added_at
items          id, vault_id, data_enc, nonce, rev, created_at, updated_at, deleted_at
sessions       id, user_id, token_hash, created_at, expires_at, ip_hash, ua_hash
audit          id, user_id, action, at, ip_hash
```

Der Tresorname steht in `vault_members`, mit `VK` verschlüsselt. Damit darf jeder seinen
eigenen Namen für denselben Tresor haben, und der Server sieht keinen davon.

`items.data_enc` ist ein JSON-Blob mit allem drin (Titel, URL, Benutzername, Passwort, Notiz,
TOTP-Geheimnis). Ein Blob statt einzelner Felder, weil das die Feldstruktur mit versteckt und
den Code kürzer macht.

Der Aufbau des Internetarchivs fehlt hier bewusst, siehe Frage B.

### 4.3 Serverseite

- Ein einziger Einstiegspunkt `index.php`. Alles andere liegt unterhalb des Webroots, oder,
  falls der Hoster das nicht zulässt, in einem Ordner mit `deny all` und zufälligem Namen.
- Die SQLite-Datei gehört außerhalb des Webroots. `checkup.php` sagt uns, ob das geht.
- PDO, ausschließlich vorbereitete Anweisungen, `PRAGMA foreign_keys = ON`, WAL.
- Sitzungscookie: `HttpOnly`, `Secure`, `SameSite=Strict`, eigener Pfad.
- CSRF: Token je Sitzung, Prüfung bei jedem schreibenden Aufruf.
- CSP mit Nonce, ohne `unsafe-inline`: `default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- Dazu HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Anmeldeversuche mit wachsender Verzögerung, je Konto und je IP.
- Nach außen keine Fehlerdetails, intern ein Logfile ohne Geheimnisse.

---

## 5. Roadmap

| Version | Inhalt | Status |
|---|---|---|
| v0.1 | Server-Check | **geliefert**, Rücklauf offen |
| v0.2 | Fundament: Schema, Front-Controller, Header, Sitzungen, Rate-Limit | wartet auf Frage A + Server-Check |
| v0.3 | Konten und Krypto-Kern: Registrierung, Login, Entsperren, Wiederherstellungscode | |
| v0.4 | Tresore und Einträge: anlegen, ändern, suchen, Passwortgenerator | |
| v0.5 | Familie: Freigaben, Rollen, Modus für die Tochter | |
| v0.6 | Oberfläche: Gestaltung, PWA, Autosperre, Zwischenablage mit Timer | |
| v0.7 | Internetarchiv | wartet auf Frage B |
| v0.8 | Export, Import, Backup (alles verschlüsselt) | |
| v1.0 | Härtung, Testfälle, Notfallzettel für die Familie | |

---

## 6. Offene Entscheidungen

Alle vier blockieren. Ohne sie wird nichts gebaut.

**A – Zero-Knowledge, ja oder nein?**
Der Vorschlag aus 4.1 heißt: Server geknackt oder Hoster neugierig, egal, die Passwörter
bleiben unlesbar. Preis: Master-Passwort vergessen und Wiederherstellungscode verloren heißt
Daten weg. Endgültig. Die Alternative wäre serverseitige Verschlüsselung, bei der PHP entschlüsseln
kann. Dann sind Zurücksetzen und Suche einfach, aber ein Einbruch auf dem Server öffnet alles.
Zusatzfrage: Admin-Wiederherstellung für das Konto der Tochter?

**B – Was ist das „Internetarchiv"?**
Aus dem v0 nicht erschließbar. Lesezeichen mit Notizen? Kopien von Webseiten? Zugangsdaten
plus Chronik, was man dort wann gemacht hat? Der Umfang von v0.7 hängt komplett daran.

**C – Tochter: Alter und Rechte?**
Alter steuert die Oberfläche. Rechte steuern das Datenmodell: eigener Tresor, Lesezugriff auf
den Familientresor, oder voller Zugriff?

**D – Wie kommt der Code auf den Server, und auf welche Domain?**
FTP, SFTP, SSH? Gibt es Git auf dem Server? Domain vermutlich unter `familienfabrik.at`,
aber ungeprüft. Danach richtet sich die Form des Deploy-Pakets.

---

## 7. Konventionen für diese Zusammenarbeit

- Je Version zwei Dinge: ein Deploy-Paket zum Hochladen und ein fortgeschriebenes Handover.
- Sprache im Produkt und in der Doku: Deutsch.
- Keine Frameworks, keine CDNs, keine Tracker, keine externen Aufrufe zur Laufzeit.
- Der Nutzer will keine Rückfragen mitten in der Arbeit. Fragen werden gesammelt und
  gebündelt gestellt, danach wird durchgearbeitet.

### Hinweis für den Bau-Container

PHP fehlt dort zunächst, lässt sich aber nachinstallieren:

```bash
apt-get update && apt-get install -y php-cli php8.3-sqlite3 php8.3-mbstring
```

Danach stehen `sodium`, `pdo_sqlite`, `mbstring`, `json` und `openssl` bereit. Jede PHP-Datei
vor der Auslieferung mit `php -l` prüfen und nach Möglichkeit gegen `php -S 127.0.0.1:8899`
laufen lassen. So wurde `checkup.php` abgenommen.
