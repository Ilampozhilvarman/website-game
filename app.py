import asyncio
import json
import random
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

BASE = Path(__file__).parent
app = FastAPI()

MAX_AMMO = 3
REVEAL_SECONDS = 3            # how long both clients show the revealed moves
HANDS = ("left", "right")
ACTIONS = ("shoot", "reload", "shield", "mirror")
CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"   # no I/O, easier to read out loud


# --- Static files (so phones/laptops just open the server's address) ---
@app.get("/")
def index():
    return FileResponse(BASE / "index.html")


@app.get("/script.js")
def script():
    return FileResponse(BASE / "script.js")


@app.get("/style.css")
def style():
    return FileResponse(BASE / "style.css")


# --- Game state ---
class Room:
    def __init__(self, code):
        self.code = code
        self.players = {}       # "p1" / "p2" -> WebSocket
        self.started = False
        self.reset()

    def reset(self):
        self.bullets = {p: {"left": 0, "right": 0} for p in ("p1", "p2")}
        self.shielded = {"p1": False, "p2": False}   # Shield only every other turn
        self.moves = {"p1": None, "p2": None}
        self.accepting = True
        self.over = False
        self.rematch = set()


rooms = {}


def new_code():
    while True:
        code = "".join(random.choices(CODE_LETTERS, k=4))
        if code not in rooms:
            return code


async def send(ws, **msg):
    try:
        await ws.send_json(msg)
    except Exception:
        pass    # that player is gone; their disconnect is handled elsewhere


async def broadcast(room, **msg):
    for ws in list(room.players.values()):
        await send(ws, **msg)


# --- Rules (same as the single-device game in script.js) ---
def check_move(room, player, move):
    """Return an error message if the move isn't allowed, else None."""
    if not isinstance(move, dict):
        return "Bad move."
    action, hand = move.get("action"), move.get("hand")
    if action not in ACTIONS:
        return "Unknown move."
    if hand == "both":
        if action not in ("shoot", "shield"):
            return "Only Shoot and Shield can be doubled."
    elif hand not in HANDS:
        return "Bad hand."
    hands = HANDS if hand == "both" else (hand,)
    if action == "shoot":
        need = 3 if hand == "both" else 1
        if any(room.bullets[player][h] < need for h in hands):
            return "Not enough ammo for that shot."
    if action == "shield" and room.shielded[player]:
        return "Shield needs a turn to recharge."
    return None


def shot_outcome(shot, defense):
    is_double = shot["hand"] == "both"
    if defense["action"] == "shoot":
        return "cancel"
    if defense["action"] == "shield":
        return "hit" if is_double and defense["hand"] != "both" else "blocked"
    if defense["action"] == "mirror":
        return "hit" if is_double else "reflected"
    return "hit"    # Reload doesn't protect you


def resolve_turn(room):
    """Apply both moves. Returns the winner ("p1"/"p2") or None."""
    winner = None
    for s, t in (("p1", "p2"), ("p2", "p1")):
        if room.moves[s]["action"] != "shoot":
            continue
        result = shot_outcome(room.moves[s], room.moves[t])
        if result == "hit":
            winner = s
        elif result == "reflected":
            winner = t
    for p in ("p1", "p2"):
        m = room.moves[p]
        hands = HANDS if m["hand"] == "both" else (m["hand"],)
        if m["action"] == "reload":
            room.bullets[p][m["hand"]] = min(MAX_AMMO, room.bullets[p][m["hand"]] + 1)
        elif m["action"] == "shoot":
            cost = 3 if m["hand"] == "both" else 1
            for h in hands:
                room.bullets[p][h] -= cost
        room.shielded[p] = m["action"] == "shield"
    return winner


# --- Game flow ---
async def start_game(room):
    room.reset()
    room.started = True
    for p, ws in list(room.players.items()):
        await send(ws, type="start", you=p)


async def finish_turn(room):
    winner = resolve_turn(room)
    await broadcast(room, type="reveal", moves=room.moves, bullets=room.bullets,
                    shielded=room.shielded, winner=winner)
    if winner:
        room.over = True
        return
    await asyncio.sleep(REVEAL_SECONDS)
    if len(room.players) < 2:
        return
    room.moves = {"p1": None, "p2": None}
    room.accepting = True
    await broadcast(room, type="next_turn")


async def handle_move(room, me, move):
    ws = room.players[me]
    if len(room.players) < 2 or room.over or not room.accepting or room.moves[me]:
        await send(ws, type="error", kind="move", message="You can't move right now.")
        return
    problem = check_move(room, me, move)
    if problem:
        await send(ws, type="error", kind="move", message=problem)
        return
    room.moves[me] = {"action": move["action"], "hand": move["hand"]}
    # Decide synchronously (no await in between) so only one task resolves the turn.
    both_in = all(room.moves.values())
    if both_in:
        room.accepting = False
    other = "p2" if me == "p1" else "p1"
    if other in room.players:
        await send(room.players[other], type="locked", player=me)
    if both_in:
        await finish_turn(room)


async def leave(room, me):
    room.players.pop(me, None)
    await broadcast(room, type="opponent_left")
    if not room.players:
        rooms.pop(room.code, None)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    room, me = None, None
    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
                kind = msg.get("type")
            except (ValueError, AttributeError):
                continue

            if kind == "create" and room is None:
                room = Room(new_code())
                rooms[room.code] = room
                me = "p1"
                room.players[me] = ws
                await send(ws, type="created", code=room.code)

            elif kind == "join" and room is None:
                target = rooms.get(str(msg.get("code", "")).strip().upper())
                if target is None or target.started or "p1" not in target.players:
                    await send(ws, type="error", message="No open game with that code.")
                    continue
                room, me = target, "p2"
                room.players[me] = ws
                await start_game(room)

            elif kind == "move" and room is not None:
                await handle_move(room, me, msg.get("move"))

            elif kind == "rematch" and room is not None and room.over:
                room.rematch.add(me)
                if len(room.rematch) == 2 and len(room.players) == 2:
                    await start_game(room)
                else:
                    other = "p2" if me == "p1" else "p1"
                    if other in room.players:
                        await send(room.players[other], type="rematch_requested")
    except WebSocketDisconnect:
        pass
    finally:
        if room is not None:
            await leave(room, me)
