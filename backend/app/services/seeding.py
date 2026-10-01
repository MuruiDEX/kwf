"""Seeding: strongest athletes spread across bracket so top-2 meet only in final."""
from __future__ import annotations

def seed_order(size: int) -> list[int]:
    """Return slot indices in seed-placement order. Standard tournament seeding."""
    order = [0]
    while len(order) < size:
        n = len(order) * 2
        nxt: list[int] = []
        for x in order:
            nxt.append(x)
            nxt.append(n - 1 - x)
        order = nxt
    return order

def assign_seeds(athlete_ids_by_strength: list[int], size: int) -> list[int | None]:
    """Map bracket slots -> athlete id (or None for bye). Strongest first."""
    order = seed_order(size)
    slots: list[int | None] = [None] * size
    for rank, aid in enumerate(athlete_ids_by_strength[:size]):
        slots[order[rank]] = aid
    return slots

def next_power_of_two(n: int) -> int:
    p = 4
    while p < n:
        p *= 2
    return min(p, 128)
