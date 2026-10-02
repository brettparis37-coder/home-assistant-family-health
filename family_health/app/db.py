"""Versioned person-based family records in the shared Home Assistant database."""
from __future__ import annotations

import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path

APP_ID = "family_health"
SCHEMA_VERSION = 1


class ValidationError(ValueError):
    pass


def _text(value, field, maximum=240, required=False):
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be text")
    value = value.strip()
    if required and not value:
        raise ValidationError(f"{field} is required")
    if len(value) > maximum:
        raise ValidationError(f"{field} is too long")
    return value


def _number(value, field, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{field} must be a number")
    value = float(value)
    if not minimum <= value <= maximum:
        raise ValidationError(f"{field} is outside the allowed range")
    return value


def _instant(value, field):
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a date and time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("missing time zone")
        return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except ValueError as exc:
        raise ValidationError(f"{field} must include a valid time zone") from exc


def _day(value):
    if not isinstance(value, str):
        raise ValidationError("birth_date must be a date")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValidationError("birth_date must be YYYY-MM-DD") from exc


def _id():
    return uuid.uuid4().hex


def _row(row):
    return dict(row) if row is not None else None


class FamilyDatabase:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS app_schema_versions (
                app_id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at REAL NOT NULL)""")
            old = db.execute("SELECT version FROM app_schema_versions WHERE app_id=?", (APP_ID,)).fetchone()
            version = old[0] if old else 0
            if version > SCHEMA_VERSION:
                raise RuntimeError("Family Health database schema is newer than this app")
            if version < 1:
                self._v1(db)
                db.execute("""INSERT INTO app_schema_versions(app_id,version,updated_at)
                    VALUES(?,?,?) ON CONFLICT(app_id) DO UPDATE SET version=excluded.version,
                    updated_at=excluded.updated_at""", (APP_ID, 1, time.time()))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=20000")
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _v1(db):
        # Execute statements individually so a failed migration rolls back as one transaction.
        statements = [
            """CREATE TABLE IF NOT EXISTS family_people (
              id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name)>0),
              birth_date TEXT NOT NULL, birth_time TEXT,
              profile_kind TEXT NOT NULL DEFAULT 'child' CHECK(profile_kind IN ('child','adult')),
              relationship TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
            """CREATE TABLE IF NOT EXISTS family_feedings (
              id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES family_people(id) ON DELETE RESTRICT,
              kind TEXT NOT NULL CHECK(kind IN ('breast','breastmilk','formula')),
              started_at TEXT NOT NULL, ended_at TEXT,
              volume_ml REAL, breast_side TEXT CHECK(breast_side IN ('left','right','both')),
              notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              CHECK ((kind='breast' AND ended_at IS NOT NULL AND volume_ml IS NULL) OR
                     (kind IN ('breastmilk','formula') AND ended_at IS NULL AND volume_ml>0))
            )""",
            "CREATE INDEX IF NOT EXISTS family_feedings_person_time ON family_feedings(person_id,started_at DESC)",
            """CREATE TABLE IF NOT EXISTS family_measurements (
              id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES family_people(id) ON DELETE RESTRICT,
              measured_at TEXT NOT NULL, weight_g REAL, length_mm REAL,
              notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              CHECK(weight_g IS NOT NULL OR length_mm IS NOT NULL),
              CHECK(weight_g IS NULL OR weight_g>0), CHECK(length_mm IS NULL OR length_mm>0)
            )""",
            "CREATE INDEX IF NOT EXISTS family_measurements_person_time ON family_measurements(person_id,measured_at DESC)",
        ]
        for statement in statements:
            db.execute(statement)

    def people(self):
        with self.connect() as db:
            return [_row(r) for r in db.execute("SELECT * FROM family_people ORDER BY created_at,id")]

    def save_person(self, payload, person_id=None):
        name = _text(payload.get("name"), "name", 80, True)
        birth_date = _day(payload.get("birth_date"))
        birth_time = payload.get("birth_time")
        if birth_time:
            if not isinstance(birth_time, str) or len(birth_time) != 5:
                raise ValidationError("birth_time must be HH:MM")
            try:
                datetime.strptime(birth_time, "%H:%M")
            except ValueError as exc:
                raise ValidationError("birth_time must be HH:MM") from exc
        else:
            birth_time = None
        profile_kind = payload.get("profile_kind", "child")
        if profile_kind not in ("child", "adult"):
            raise ValidationError("profile_kind must be child or adult")
        relationship = _text(payload.get("relationship", ""), "relationship", 80)
        notes = _text(payload.get("notes", ""), "notes", 2000)
        now = _instant(datetime.now(timezone.utc).isoformat(), "now")
        with self.connect() as db:
            if person_id:
                result = db.execute("""UPDATE family_people SET name=?,birth_date=?,birth_time=?,profile_kind=?,relationship=?,notes=?,updated_at=? WHERE id=?""",
                                    (name,birth_date,birth_time,profile_kind,relationship,notes,now,person_id))
                if not result.rowcount:
                    raise KeyError("person not found")
            else:
                person_id = _id()
                db.execute("""INSERT INTO family_people VALUES(?,?,?,?,?,?,?,?,?)""",
                           (person_id,name,birth_date,birth_time,profile_kind,relationship,notes,now,now))
            return _row(db.execute("SELECT * FROM family_people WHERE id=?", (person_id,)).fetchone())

    def _require_person(self, db, person_id):
        person = db.execute("SELECT profile_kind FROM family_people WHERE id=?", (person_id,)).fetchone() if isinstance(person_id, str) else None
        if not person:
            raise ValidationError("Select a registered person")
        return person

    def feedings(self, person_id):
        with self.connect() as db:
            self._require_person(db, person_id)
            return [_row(r) for r in db.execute(
                "SELECT * FROM family_feedings WHERE person_id=? ORDER BY started_at DESC,id DESC",
                (person_id,))]

    def save_feeding(self, payload, feeding_id=None):
        person_id = payload.get("person_id")
        kind = payload.get("kind")
        if kind not in ("breast", "breastmilk", "formula"):
            raise ValidationError("Choose a feeding type")
        started = _instant(payload.get("started_at"), "started_at")
        ended = None
        volume = None
        side = None
        if kind == "breast":
            ended = _instant(payload.get("ended_at"), "ended_at")
            duration = (datetime.fromisoformat(ended.replace("Z", "+00:00")) -
                        datetime.fromisoformat(started.replace("Z", "+00:00"))).total_seconds()
            if not 0 < duration <= 4 * 3600:
                raise ValidationError("Breastfeeding end must follow start by at most 4 hours")
            side = payload.get("breast_side") or None
            if side not in (None, "left", "right", "both"):
                raise ValidationError("Choose a valid breast side")
        else:
            volume = _number(payload.get("volume_ml"), "volume_ml", 0.01, 2000)
        notes = _text(payload.get("notes", ""), "notes", 2000)
        now = _instant(datetime.now(timezone.utc).isoformat(), "now")
        with self.connect() as db:
            if self._require_person(db, person_id)["profile_kind"] != "child":
                raise ValidationError("Feedings are currently available for child profiles")
            if feeding_id:
                old = db.execute("SELECT person_id FROM family_feedings WHERE id=?", (feeding_id,)).fetchone()
                if not old:
                    raise KeyError("feeding not found")
                if old[0] != person_id:
                    raise ValidationError("A feeding cannot move between people")
                db.execute("""UPDATE family_feedings SET kind=?,started_at=?,ended_at=?,volume_ml=?,breast_side=?,notes=?,updated_at=? WHERE id=?""",
                           (kind,started,ended,volume,side,notes,now,feeding_id))
            else:
                feeding_id = _id()
                db.execute("INSERT INTO family_feedings VALUES(?,?,?,?,?,?,?,?,?,?)",
                           (feeding_id,person_id,kind,started,ended,volume,side,notes,now,now))
            return _row(db.execute("SELECT * FROM family_feedings WHERE id=?", (feeding_id,)).fetchone())

    def measurements(self, person_id):
        with self.connect() as db:
            self._require_person(db, person_id)
            return [_row(r) for r in db.execute(
                "SELECT * FROM family_measurements WHERE person_id=? ORDER BY measured_at DESC,id DESC",
                (person_id,))]

    def save_measurement(self, payload, measurement_id=None):
        person_id = payload.get("person_id")
        measured = _instant(payload.get("measured_at"), "measured_at")
        weight = payload.get("weight_g")
        length = payload.get("length_mm")
        if weight is None and length is None:
            raise ValidationError("Enter a weight or length")
        weight = _number(weight, "weight_g", 1, 500000) if weight is not None else None
        length = _number(length, "length_mm", 1, 3000) if length is not None else None
        notes = _text(payload.get("notes", ""), "notes", 2000)
        now = _instant(datetime.now(timezone.utc).isoformat(), "now")
        with self.connect() as db:
            self._require_person(db, person_id)
            if measurement_id:
                old = db.execute("SELECT person_id FROM family_measurements WHERE id=?", (measurement_id,)).fetchone()
                if not old:
                    raise KeyError("measurement not found")
                if old[0] != person_id:
                    raise ValidationError("A measurement cannot move between people")
                db.execute("""UPDATE family_measurements SET measured_at=?,weight_g=?,length_mm=?,notes=?,updated_at=? WHERE id=?""",
                           (measured,weight,length,notes,now,measurement_id))
            else:
                measurement_id = _id()
                db.execute("INSERT INTO family_measurements VALUES(?,?,?,?,?,?,?,?)",
                           (measurement_id,person_id,measured,weight,length,notes,now,now))
            return _row(db.execute("SELECT * FROM family_measurements WHERE id=?", (measurement_id,)).fetchone())

    def delete(self, table, row_id):
        if table not in ("family_feedings", "family_measurements"):
            raise ValidationError("Invalid record type")
        with self.connect() as db:
            result = db.execute(f"DELETE FROM {table} WHERE id=?", (row_id,))
            if not result.rowcount:
                raise KeyError("record not found")

