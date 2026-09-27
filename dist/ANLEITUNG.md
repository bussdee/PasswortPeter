# PasswortPeter

Eine einzige Datei. Kein Konto, kein Internet, keine Anmeldung irgendwo.

---

## Was hier drin ist

**PasswortPeter.html** ist das Programm.
**Familie.peter** (oder wie ihr euren Tresor nennt) ist der Inhalt.

Zwei Dateien, mehr nicht. Beide könnt ihr kopieren, auf einen Stick legen,
per Mail schicken. Die `.peter`-Datei ist ohne das Master-Passwort ein Haufen
Zufall, mit dem niemand etwas anfangen kann.

## Loslegen

1. **PasswortPeter.html** doppelklicken. Der Browser geht auf.
2. **Neuen Tresor anlegen** wählen, Namen und Master-Passwort eingeben.
3. Der Tresor wird sofort heruntergeladen. Die Datei liegt jetzt bei euren
   Downloads. Legt sie dorthin, wo ihr sie haben wollt.

## Jeden Tag

1. **PasswortPeter.html** doppelklicken.
2. Die `.peter`-Datei ins Feld ziehen, oder klicken und auswählen.
3. Master-Passwort eingeben. Das Aufsperren dauert ein bis vier Sekunden.
   Das ist Absicht: dieselbe Wartezeit bremst jeden, der das Passwort raten will.

## Speichern

Ein Klick auf **Speichern** lädt eine neue `.peter`-Datei herunter.
Die alte ersetzen, fertig.

> Der Punkt neben dem Tresornamen ist **grün**, wenn alles gespeichert ist,
> und **gold**, wenn es Änderungen gibt. Der Speichern-Knopf bekommt dann
> einen Stern.

Solange nicht gespeichert ist, existieren die Änderungen nur in diesem Fenster.
Fenster zu heißt: weg.

## Karten

Jede Seite ist eine Karte. Eine Karte braucht nur einen Titel oder eine Adresse.

- **Mit Benutzer und Passwort** ist es ein Zugang.
- **Ohne Benutzer und Passwort** ist es einfach ein Lesezeichen.

Beides steht nebeneinander im selben Kasten, sortiert nach Reitern.

## Die Knöpfe auf einer Karte

| Zeichen | Was passiert |
|---|---|
| Kugel | Die Website geht in einem neuen Tab auf |
| Schlüssel | Das Passwort geht in die Zwischenablage und löscht sich nach 20 Sekunden wieder |
| Stern | Die Karte wandert nach oben zu den Favoriten |

Ein Klick auf die Karte selbst öffnet alle Angaben.

## Tastatur

| Taste | Was |
|---|---|
| `Strg` + `S` | Speichern |
| `Strg` + `L` | Zusperren |
| `Esc` | Fenster schließen |

## Der Tresor sperrt von selbst zu

Nach fünf Minuten ohne Bewegung. Gibt es dann ungespeicherte Änderungen,
fragt Peter erst nach und wartet 90 Sekunden.

## Einen Tresor weitergeben

Die `.peter`-Datei schicken und das Master-Passwort mündlich sagen.
Nicht in derselben Mail. Nicht im selben Chat.

> **Achtung:** Ab dann gibt es zwei Kopien. Wenn zwei Leute gleichzeitig etwas
> ändern, gewinnt die zuletzt gespeicherte Datei, und die andere Änderung ist weg.
> Solange einer den Familientresor pflegt und die anderen ihn benutzen, passt das.

## Das Wichtigste

**Es gibt keine Wiederherstellung.** Kein Zurücksetzen, keine Notfallfrage,
keine Hintertür. Das war eine bewusste Entscheidung: es gibt niemanden, der
euren Tresor öffnen könnte, also auch keinen, der dazu gezwungen werden kann.

Zwei Dinge folgen daraus:

1. **Master-Passwort auf Papier.** Dorthin, wo auch die Geburtsurkunden liegen.
2. **Die `.peter`-Datei sichern.** Auf einen Stick, in eine Cloud, egal wohin.
   Die Datei ist verschlüsselt, sie darf überall liegen. Datei weg heißt
   Passwörter weg, und daran ändert auch das beste Master-Passwort nichts.

Ein Backup ist keine Hintertür. Es ist die einzige Versicherung, die es hier gibt.

---

## Neu ab v0.3

**Speichern in dieselbe Datei.** Auf Chrome, Edge und Opera am Computer fragt Peter
beim ersten Speichern einmal, wohin, und überschreibt danach immer genau diese
Datei. Kein `Familie (10).peter` mehr. Firefox und Handys laden weiter herunter,
das ist technisch nicht anders lösbar.

**Kassensturz.** Im Werkzeug links. Zeigt, welche Passwörter mehrfach benutzt oder
zu schwach sind, und führt mit einem Tipp direkt zur Karte, wo du mit dem
Würfel-Knopf ein neues erzeugst. Der grüne Haken heißt: alles sauber.

**Import.** Ebenfalls im Werkzeug. Hol deine Zugänge aus einem anderen Programm
(Bitwarden, KeePass, Chrome, Firefox und andere als CSV) oder deine Lesezeichen
als HTML-Export herein. Peter zeigt vorher, was er gefunden hat, und überspringt
Dubletten. Nichts verlässt dabei das Fenster.

**Papierkorb.** Gelöschte Karten sind nicht sofort weg, sondern landen im
Papierkorb und lassen sich zurückholen. Direkt nach dem Löschen genügt der
Zurückholen-Knopf im kurzen Hinweis unten.

**Master-Passwort ändern.** Im Menü (···) oben rechts. Gilt ab dem nächsten
Speichern. Auch hierfür gibt es keine Wiederherstellung.

**Kleinigkeiten.** Benutzernamen lassen sich jetzt direkt von der Karte kopieren.
Mit `/` oder `Strg`+`K` springst du ins Suchfeld. Der Knopf links neben Speichern
schaltet die Sortierung um: A–Z, zuletzt benutzt, neueste zuerst.

> **Der Export als CSV** (im Menü) ist ein Notausgang für den Wechsel zu einem
> anderen Programm. Diese Datei ist **nicht** verschlüsselt und gehört sofort nach
> Gebrauch gelöscht.

---

## Neu ab v0.4

**Notfallzettel.** Im Menü (···) → „Notfallzettel drucken". Das ist die wichtigste
Absicherung überhaupt. Peter druckt einen Zettel mit dem Tresornamen, wo die Datei
liegt und einer Anleitung für den Ernstfall — aber **ohne** Passwort. Das Master-
Passwort trägst du mit der Hand ein und legst den Zettel zu euren Dokumenten. Falls
dir etwas zustößt, finden Frau und Tochter darüber den Weg in den Tresor.

**Merksatz.** Beim Anlegen eines Tresors und beim Würfeln eines Passworts gibt es
jetzt neben dem Zufallspasswort einen „Merksatz": mehrere zufällige Wörter, die man
sich leichter merkt und die trotzdem stark sind. Gedacht vor allem fürs Master-
Passwort, das einzige, das du dir merken musst.

**Einstellungen.** Im Menü. Zwei Regler: nach wie vielen Minuten der Tresor von
selbst zusperrt, und wie stark die Verschlüsselung rechnet. Auf einem älteren Handy
stell „Sparsam" ein, wenn das Aufsperren zu lange dauert; wer es besonders sicher
will, nimmt „Streng".

**Warnung bei doppelten Passwörtern.** Wenn du beim Bearbeiten ein Passwort eintippst,
das du schon woanders benutzt, sagt Peter dir sofort, wo.

**Reiter sortieren.** Unter „Reiter verwalten" kannst du die Reihenfolge mit den
Pfeilen ändern.

**Kleinigkeiten.** Im Hintergrund (anderer Tab) sperrt der Tresor schneller zu.
In Dialogen bleibt die Tab-Taste sauber im Fenster.
