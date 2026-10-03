"""Writes src/mock/fixtures.json: one scripted afternoon at the stall, as the agents' WS /events send it.

Rows follow docs/services.md. Most are the public view (bazaar PR #69); a few still carry the private
fields the agents published before it (`reason`, `inputs.value`, `jev.probabilities`), so the mock also
proves the show's allow-list drops them. Run: python3 scripts/make-fixtures.py
"""
import json
from pathlib import Path

T0, TICK_HOURS = 300, 15 / 3600
ids = {"taker": 0, "maker": 0}
steps = []
clock = {"tick": T0, "ms": 0}


def env(agent, type_, payload):
    ids[agent] -= 1
    return {
        "id": ids[agent], "tick": clock["tick"], "t": round(6.0 + (clock["tick"] - T0) * TICK_HOURS, 3),
        "type": type_, "scope": "team", "actor": "t01", "agent": agent, "payload": {**payload, "agent": agent},
    }


def at(gap_ms, agent, type_, payload):
    clock["ms"] += gap_ms
    steps.append({"at": clock["ms"], "event": env(agent, type_, payload)})


def tick(gap_ms=1200):
    clock["tick"] += 1
    for agent in ("taker", "maker"):
        at(gap_ms if agent == "taker" else 150, agent, "agent.tick", {"mode": "live"})


did = {"n": 400}


def decision(agent, kind, inputs, *, status="approved", guardrail="allowed", jev=None, move=None, thread_id=None, gap=2600, extra=None):
    did["n"] += 1
    payload = {
        "decision_id": did["n"], "tick": clock["tick"], "kind": kind, "chosen": status == "approved",
        "status": status, "dry_run": False, "sent": "sending" if status == "approved" else "not sent",
        "thread_id": thread_id, "guardrail": guardrail, "jev": jev, "inputs": inputs, "move": move or {},
        **(extra or {}),
    }
    at(gap, agent, "agent.decision", payload)
    return did["n"]


def execution(agent, decision_id, method, request, *, error=None, created=None, gap=900):
    at(gap, agent, "agent.execution", {
        "decision_id": decision_id, "tick": clock["tick"], "method": method, "request": request,
        "ok": error is None, "error_code": error, "created_id": created,
    })


# Tick 301: the seller opens the stall, the buyer snaps up a cheap ask.
tick(600)
d = decision("maker", "post_ask", {"side": "ask", "ref": "LAT-09", "rarity": "rare", "price": 68, "venue": "rastro"},
             jev={"verdict": "aggressive"}, move={"give": {"assets": [771]}, "want": {"cash": 68}, "venue": "rastro"})
execution("maker", d, "list_offer", {"give": {"assets": [771]}, "want": {"cash": 68}, "venue": "rastro"}, created=9101)
d = decision("maker", "post_ask", {"side": "ask", "ref": "MAL-03", "rarity": "common", "price": 24, "venue": "rastro"},
             move={"want": {"cash": 24}, "venue": "rastro"},
             # Pre-#69 private fields: the show must never say 41.5, 0.82 or the reason.
             extra={"reason": "ours 17.5 + page bonus 24.0; value 41.5", "line": "post ask MAL-03 at 24 (value 41.5)"})
execution("maker", d, "list_offer", {"want": {"cash": 24}, "venue": "rastro"}, created=9102)
d = decision("taker", "accept_ask", {"offer_id": 5512, "venue": "rastro", "maker": "t07", "ref": "SAL-05", "rarity": "uncommon", "ask": 18, "fee": 1.9},
             jev={"verdict": "yes"}, move={"accept": 5512, "price": 18})
execution("taker", d, "accept", {"offer": 5512}, created=None)

# Tick 302: Abuela Carmen, a pack, some haggling; Jev nudges a reprice; a guardrail says no.
tick()
d = decision("taker", "dealer_open", {"dealer": "abuela", "item": "sobre_barrio"}, move={"open_thread": "abuela", "topic": {"buy": "sobre_barrio"}})
execution("taker", d, "open_thread", {"with": "abuela", "topic": {"buy": {"pack": "sobre_barrio"}}}, created=331)
d = decision("taker", "dealer_bid", {"dealer": "abuela", "thread": 331, "item": "sobre_barrio", "her_ask": 30, "final": False, "price": 20},
             move={"kind": "bid", "price": 20}, thread_id=331)
execution("taker", d, "say", {"thread": 331, "price": 20})
decision("maker", "reprice_ask", {"offer": {"ref": "LAT-09", "side": "ask", "venue": "rastro"}, "price": 62},
         jev={"verdict": "fair", "value": 0.71, "probabilities": {"aggressive": 0.2, "fair": 0.71, "quick_sale": 0.09}},
         move={"reprice": 9101, "price": 62})
decision("taker", "accept_ask", {"ref": "LAV-11", "venue": "rastro"}, status="rejected",
         guardrail="denied: price 40 > max_price_uncommon 26", extra={"reason": "worth 25x1.6 = 40"})

# Tick 303: a deal with Abuela, the seller holds three prices.
tick()
d = decision("taker", "dealer_bid", {"dealer": "abuela", "thread": 331, "item": "sobre_barrio", "her_ask": 27, "final": False, "price": 24},
             move={"kind": "bid", "price": 24}, thread_id=331)
execution("taker", d, "say", {"thread": 331, "price": 24})
d = decision("taker", "dealer_accept", {"dealer": "abuela", "thread": 331, "item": "sobre_barrio", "offer_id": 6120, "ask": 25, "final": True},
             jev={"verdict": "accept"}, move={"accept": 6120, "price": 25}, thread_id=331)
execution("taker", d, "accept", {"offer": 6120})
for ref, oid in (("MAL-03", 9102), ("LAT-09", 9103), ("SAL-02", 8990)):
    decision("maker", "hold_ask", {"offer": {"ref": ref, "side": "ask", "venue": "rastro"}}, jev={"verdict": "hold"}, move={"hold": oid}, gap=500)

# Tick 304: El Chato is not impressed.
tick()
d = decision("taker", "dealer_open", {"dealer": "chato", "item": "rare"}, move={"open_thread": "chato", "topic": {"buy": "rare"}})
execution("taker", d, "open_thread", {"with": "chato", "topic": {"buy": {"rarity": "rare"}}}, created=340)
d = decision("taker", "dealer_bid", {"dealer": "chato", "thread": 340, "item": "rare", "her_ask": 95, "final": False, "price": 60},
             move={"kind": "bid", "price": 60}, thread_id=340)
execution("taker", d, "say", {"thread": 340, "price": 60})
d = decision("taker", "dealer_walk", {"dealer": "chato", "thread": 340, "item": "rare", "her_ask": 88, "final": True},
             move={"kind": "walk"}, thread_id=340)
execution("taker", d, "close_thread", {"thread": 340})

# Tick 305: tidying the board, a bid, a refusal from the game, a late row and a pass.
tick()
d = decision("maker", "cancel_ask", {"offer_id": 9102, "side": "ask", "ref": "MAL-03", "price": 24, "venue": "rastro"}, move={"cancel": 9102})
execution("maker", d, "cancel", {"offer": 9102})
d = decision("maker", "post_bid", {"side": "bid", "ref": "RET-02", "rarity": "uncommon", "price": 30, "venue": "rastro"},
             move={"want": {"cards": ["RET-02"]}, "venue": "rastro"})
execution("maker", d, "list_offer", {"want": {"cards": ["RET-02"]}, "give": {"cash": 30}, "venue": "rastro"}, created=9104)
d = decision("taker", "accept_ask", {"offer_id": 5530, "venue": "rastro", "maker": "t03", "ref": "CHA-07", "rarity": "rare", "ask": 44},
             move={"accept": 5530, "price": 44})
execution("taker", d, "accept", {"offer": 5530}, error="insufficient_cash")
decision("maker", "post_ask", {"side": "ask", "ref": "LAT-12", "venue": "rastro"}, status="expired")
decision("taker", "accept_ask", {"ref": "RET-07", "venue": "rastro"}, status="skipped", gap=2200)
clock["ms"] += 4000

out = {
    "about": "Recorded-style scene for ?mock=1. Envelopes as WS /events sends them (docs/services.md).",
    "loopMs": clock["ms"],
    "ticksPerLoop": clock["tick"] - T0,
    "health": {
        "taker": {"ok": True, "agent": "taker", "mode": "live", "tick": T0, "last_tick_at": None, "doors": "open",
                  "paused": False, "next_opens": None, "tick_seconds": 15.0, "server_tick": T0},
        "maker": {"ok": True, "agent": "maker", "mode": "live", "tick": T0, "last_tick_at": None, "doors": "open",
                  "paused": False, "next_opens": None, "tick_seconds": 15.0, "server_tick": T0},
    },
    "state": {
        "maker": {"agent": "maker", "mode": "live", "tick": T0, "team": "t01",
                  "open_offers": [{"id": 8990, "side": "ask", "ref": "SAL-02", "price": 31, "venue": "rastro"},
                                  {"id": 8991, "side": "ask", "ref": "LAV-04", "price": 12, "venue": "rastro"}]},
        "taker": {"agent": "taker", "mode": "live", "tick": T0, "team": "t01", "threads": []},
    },
    "steps": steps,
}
path = Path(__file__).resolve().parent.parent / "src" / "mock" / "fixtures.json"
path.write_text(json.dumps(out, indent=1) + "\n")
print(f"{len(steps)} events, loop {clock['ms'] / 1000:.1f}s -> {path}")
