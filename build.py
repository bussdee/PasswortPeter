#!/usr/bin/env python3
"""PasswortPeter – Bau.

Fügt libsodium, die Gestaltung und die drei Skripte zu genau einer HTML-Datei
zusammen. Danach ein paar Prüfungen, die verhindern, dass eine kaputte oder
undichte Datei ausgeliefert wird.

Aufruf:  python3 build.py
"""

import re
import sys
from pathlib import Path

HIER = Path(__file__).parent
SRC = HIER / "src"
LIB = HIER.parent / "lib" / "node_modules"
DIST = HIER / "dist"

TEILE = {
    "CSS":      SRC / "style.css",
    "SODIUM":   LIB / "libsodium-sumo" / "dist" / "modules-sumo" / "libsodium-sumo.js",
    "WRAPPERS": LIB / "libsodium-wrappers-sumo" / "dist" / "modules-sumo" / "libsodium-wrappers.js",
    "VAULT":    SRC / "vault.js",
    "SEAL":     SRC / "seal.js",
    "APP":      SRC / "app.js",
}


def fehler(text):
    print("  FEHLER: " + text)
    sys.exit(1)


def bauen():
    shell = (SRC / "shell.html").read_text(encoding="utf-8")

    for name, pfad in TEILE.items():
        if not pfad.exists():
            fehler(f"{name} fehlt: {pfad}")
        inhalt = pfad.read_text(encoding="utf-8")

        # Ein </script> im Code würde das umschließende Tag vorzeitig schließen
        # und die Datei zerreißen. Ist bisher nie vorgekommen, wird aber geprüft.
        if name != "CSS" and re.search(r"</script", inhalt, re.I):
            fehler(f"{name} enthält '</script'. Das würde die HTML-Datei zerreißen.")
        if name == "CSS" and re.search(r"</style", inhalt, re.I):
            fehler("Das Stylesheet enthält '</style'.")

        marke = f"/* @@{name}@@ */"
        if marke not in shell:
            fehler(f"Platzhalter {marke} steht nicht im Gerüst.")
        shell = shell.replace(marke, inhalt)
        print(f"  eingebaut  {name:9} {len(inhalt)/1024:8.1f} KB")

    DIST.mkdir(exist_ok=True)
    ziel = DIST / "PasswortPeter.html"
    ziel.write_text(shell, encoding="utf-8")
    return ziel, shell


def pruefen(ziel, html):
    print("\n  Prüfungen:")
    fehlgeschlagen = []

    def pruefe(name, bedingung, detail=""):
        if bedingung:
            print(f"    ok    {name}")
        else:
            fehlgeschlagen.append(name + (f" ({detail})" if detail else ""))
            print(f"    NEIN  {name}  {detail}")

    # Gezielt die eigenen Marken suchen. Ein blindes "@@" findet Bytes im
    # eingebetteten WebAssembly und schlägt grundlos Alarm.
    uebrig = [n for n in TEILE if f"@@{n}@@" in html]
    pruefe("Kein Platzhalter übrig", not uebrig, str(uebrig))

    pruefe("Genau ein </html>", html.count("</html>") == 1)
    # Über das schließende Tag zählen. Die Zeichenfolge "<script>" kommt auch in
    # libsodiums eigenen Zeichenketten vor, "</script>" dagegen nirgends.
    pruefe("Fünf Skriptblöcke", html.count("</script>") == 5, f"{html.count('</script>')} gefunden")

    # Kein einziger Verweis nach außen. Das ist der Kern des Versprechens.
    extern = re.findall(r'(?:src|href)\s*=\s*["\'](https?:)?//[^"\']+', html, re.I)
    pruefe("Keine externen Quellen eingebunden", not extern, str(extern[:3]))

    # Netzfunktionen im selbst geschriebenen Code. libsodium bringt in seinem
    # Emscripten-Gerüst ein fetch mit, das nie aufgerufen wird, weil das
    # WebAssembly eingebettet ist. Nachgewiesen wird das in test_dom.js, wo die
    # Datei ohne Netz und ohne Dateisystem startet. Hier wird geprüft, dass
    # wenigstens der eigene Code sauber ist.
    eigener = "".join((SRC / n).read_text(encoding="utf-8") for n in ["vault.js", "seal.js", "app.js"])
    for muster, name in [
        (r"\bfetch\s*\(", "fetch"),
        (r"XMLHttpRequest", "XMLHttpRequest"),
        (r"navigator\.sendBeacon", "sendBeacon"),
        (r"new\s+WebSocket", "WebSocket"),
        (r"new\s+EventSource", "EventSource"),
        (r"new\s+Image\s*\(", "Image-Pixel"),
    ]:
        pruefe(f"Eigener Code ohne {name}", not re.search(muster, eigener))

    pruefe("connect-src 'none' steht in der CSP", "connect-src 'none'" in html)
    pruefe("default-src 'none' steht in der CSP", "default-src 'none'" in html)

    for speicher in ["localStorage", "sessionStorage", "indexedDB", "openDatabase"]:
        pruefe(f"Kein {speicher} im eigenen Code", speicher not in eigener)

    pruefe("Argon2id ist eingebaut", "crypto_pwhash_ALG_ARGON2ID13" in html)
    pruefe("XChaCha20-Poly1305 ist eingebaut", "crypto_aead_xchacha20poly1305_ietf_encrypt" in html)

    groesse = ziel.stat().st_size
    pruefe("Datei unter 3 MB", groesse < 3 * 1024 * 1024, f"{groesse/1024/1024:.2f} MB")

    return fehlgeschlagen


def main():
    print("\n  PasswortPeter – Bau\n")
    ziel, html = bauen()
    fehlgeschlagen = pruefen(ziel, html)

    print()
    if fehlgeschlagen:
        print("  BAU DURCHGEFALLEN:")
        for f in fehlgeschlagen:
            print("    - " + f)
        sys.exit(1)

    print(f"  Fertig: {ziel}")
    print(f"  Größe:  {ziel.stat().st_size/1024/1024:.2f} MB, eine einzige Datei, kein Netzzugriff\n")


if __name__ == "__main__":
    main()
