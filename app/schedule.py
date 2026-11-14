"""Deterministic planner for the browser-held demo calendar.

The server stores nothing. The browser sends its demo calendar with each request,
so these functions only check availability and validate a proposed booking.
No external calendar is read or changed.
"""

import re
import uuid

from pydantic import BaseModel, Field, field_validator

TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def minutes(value: str) -> int:
    hours, mins = value.split(":")
    return int(hours) * 60 + int(mins)


def clock(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


class CalendarEvent(BaseModel):
    id: str = Field(default="", max_length=100)
    title: str = Field(min_length=1, max_length=120)
    date: str
    start: str
    end: str
    created_by: str = Field(default="", max_length=40)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        if not DATE.match(value):
            raise ValueError("Use YYYY-MM-DD.")
        return value

    @field_validator("start", "end")
    @classmethod
    def valid_time(cls, value: str) -> str:
        if not TIME.match(value):
            raise ValueError("Use HH:MM.")
        return value


class SlotRequest(BaseModel):
    events: list[CalendarEvent] = Field(max_length=200)
    date: str
    window_start: str = "12:00"
    window_end: str = "17:00"
    duration_minutes: int = Field(default=30, ge=10, le=240)
    skip: list[str] = Field(default=[], max_length=50)

    @field_validator("window_start", "window_end")
    @classmethod
    def valid_time(cls, value: str) -> str:
        if not TIME.match(value):
            raise ValueError("Use HH:MM.")
        return value


class BookRequest(BaseModel):
    events: list[CalendarEvent] = Field(max_length=200)
    event: CalendarEvent


def conflicts(events: list[CalendarEvent], date: str, start: int, end: int) -> list[CalendarEvent]:
    return [e for e in events if e.date == date and minutes(e.start) < end and start < minutes(e.end)]


def find_slot(body: SlotRequest) -> dict:
    """Walk the window in 30-minute steps; report every candidate checked."""
    start, end = minutes(body.window_start), minutes(body.window_end)
    checked, step = [], 30
    for candidate in range(start, end - body.duration_minutes + 1, step):
        stop = candidate + body.duration_minutes
        label = {"start": clock(candidate), "end": clock(stop)}
        if clock(candidate) in body.skip:
            checked.append({**label, "status": "declined", "detail": "You asked for a different time."})
            continue
        busy = conflicts(body.events, body.date, candidate, stop)
        if busy:
            checked.append({**label, "status": "busy", "detail": ", ".join(e.title for e in busy)})
            continue
        checked.append({**label, "status": "free", "detail": "Available"})
        return {"slot": {"date": body.date, **label}, "checked": checked}
    return {"slot": None, "checked": checked}


def book(body: BookRequest) -> tuple[bool, dict]:
    event = body.event
    start, end = minutes(event.start), minutes(event.end)
    if end <= start:
        return False, {"detail": "The event must end after it starts.", "conflicts": []}
    busy = conflicts(body.events, event.date, start, end)
    if busy:
        return False, {
            "detail": "That time is no longer free.",
            "conflicts": [e.model_dump() for e in busy],
        }
    created = event.model_copy(update={"id": f"cal-{uuid.uuid4().hex[:12]}", "created_by": "threadline"})
    return True, {"event": created.model_dump(), "events": [e.model_dump() for e in body.events] + [created.model_dump()]}
