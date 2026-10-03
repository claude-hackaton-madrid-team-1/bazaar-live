"""Writes server/injections/recorder-unicode.json: how bazaar's injection recorder treats every code point.

shared/injections.ts ports the recorder's `injection_flags` (bazaar src/bazaar_agent/llm/chooser.py) so that a text the
recorder stores is a text no voice of the show reads. Python and JavaScript ship different Unicode versions and script
data, so the parity test (server/injections/unicode-parity.test.ts) checks the port against this file, code point by
code point: whatever the recorder drops when it folds a text, flags as odd, or reads as a look-alike letter, the port
must too. Re-run after a change to chooser.py or a Python upgrade, from a bazaar checkout:

    cd ../bazaar && uv run python ../bazaar-live/scripts/recorder-unicode.py "$(git log -1 --format=%h -- src/bazaar_agent/llm/chooser.py)" \\
        > ../bazaar-live/server/injections/recorder-unicode.json
"""

import json
import re
import sys
import unicodedata

from bazaar_agent.llm.chooser import CONFUSABLE_SCRIPTS, folded, odd_unicode


def ranges(points: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for p in points:
        if out and p == out[-1][1] + 1:
            out[-1][1] = p
        else:
            out.append([p, p])
    return out


def main(commit: str) -> None:
    drop, odd, confusable, casefold = [], [], [], []
    for cp in range(0x110000):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        c = chr(cp)
        if folded("a" + c + "b") == "ab":
            drop.append(cp)
        if odd_unicode(c):
            odd.append(cp)
        if c.isalpha() and unicodedata.name(c, "?").split(" ")[0] in CONFUSABLE_SCRIPTS:
            confusable.append(cp)
        f = folded(c)
        if len(f) == 1 and not f.isascii():
            casefold.extend([cp, x] for x in "abcdefghijklmnopqrstuvwxyz" if re.fullmatch(x, f, re.IGNORECASE))
    json.dump(
        {
            "source": f"bazaar src/bazaar_agent/llm/chooser.py (folded, odd_unicode, CONFUSABLE_SCRIPTS) at {commit}",
            "python": sys.version.split()[0],
            "unicode": unicodedata.unidata_version,
            "fold_drop": ranges(drop),
            "odd": ranges(odd),
            "confusable_letters": ranges(confusable),
            "ignorecase_ascii": casefold,
        },
        sys.stdout,
        separators=(",", ":"),
    )


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "unknown")
