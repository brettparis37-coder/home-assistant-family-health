import sqlite3
from contextlib import closing
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "family_health" / "app"))
from db import FamilyDatabase, ValidationError  # noqa: E402


class PersistenceTests(unittest.TestCase):
    def test_reopen_preserves_records_and_unrelated_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "home_apps.sqlite3"
            with closing(sqlite3.connect(path)) as conn:
                conn.execute("CREATE TABLE discogs_sample (value TEXT)")
                conn.execute("INSERT INTO discogs_sample VALUES ('keep me')")
                conn.execute("CREATE TABLE app_schema_versions (app_id TEXT PRIMARY KEY, version INTEGER, updated_at REAL)")
                conn.execute("INSERT INTO app_schema_versions VALUES ('discogs_connector', 5, 1)")
                conn.commit()
            db = FamilyDatabase(path)
            child = db.save_person({"name": "Ada", "birth_date": "2026-09-28", "birth_time": "07:20"})
            sibling = db.save_person({"name": "Sam", "birth_date": "2026-08-01"})
            breast = db.save_feeding({"person_id": child["id"], "kind": "breast", "started_at": "2026-10-01T09:00:00-07:00", "ended_at": "2026-10-01T09:18:00-07:00", "breast_side": "left"})
            bottle = db.save_feeding({"person_id": sibling["id"], "kind": "formula", "started_at": "2026-10-01T11:00:00-07:00", "volume_ml": 73.93382390625})
            growth = db.save_measurement({"person_id": child["id"], "measured_at": "2026-10-01T12:00:00-07:00", "weight_g": 3200, "length_mm": 505})
            db = FamilyDatabase(path)  # Same operation as an app restart or reinstall.
            self.assertEqual(len(db.people()), 2)
            self.assertTrue(all(person["profile_kind"] == "child" for person in db.people()))
            self.assertEqual([r["id"] for r in db.feedings(child["id"])], [breast["id"]])
            self.assertEqual(db.feedings(sibling["id"])[0]["id"], bottle["id"])
            self.assertEqual(db.measurements(child["id"])[0]["id"], growth["id"])
            self.assertEqual(db.feedings(child["id"])[0]["started_at"], "2026-10-01T16:00:00Z")
            with closing(sqlite3.connect(path)) as conn:
                self.assertEqual(conn.execute("SELECT value FROM discogs_sample").fetchone()[0], "keep me")
                self.assertEqual(conn.execute("SELECT version FROM app_schema_versions WHERE app_id='discogs_connector'").fetchone()[0], 5)
                self.assertEqual(conn.execute("SELECT version FROM app_schema_versions WHERE app_id='family_health'").fetchone()[0], 1)

    def test_validation_and_edit_do_not_move_records_between_children(self):
        with tempfile.TemporaryDirectory() as directory:
            db = FamilyDatabase(Path(directory) / "db.sqlite3")
            a = db.save_person({"name": "A", "birth_date": "2026-01-01"})
            b = db.save_person({"name": "B", "birth_date": "2026-01-01"})
            payload = {"person_id": a["id"], "kind": "breastmilk", "started_at": "2026-10-01T12:00:00Z", "volume_ml": 60}
            row = db.save_feeding(payload)
            with self.assertRaises(ValidationError):
                db.save_feeding({**payload, "person_id": b["id"]}, row["id"])
            with self.assertRaises(ValidationError):
                db.save_feeding({**payload, "volume_ml": -2})
            updated = db.save_feeding({**payload, "volume_ml": 90}, row["id"])
            self.assertEqual(updated["volume_ml"], 90)
            db.delete("family_feedings", row["id"])
            self.assertEqual(db.feedings(a["id"]), [])

    def test_adult_profile_can_own_growth_but_not_baby_feeding(self):
        with tempfile.TemporaryDirectory() as directory:
            db = FamilyDatabase(Path(directory) / "db.sqlite3")
            adult = db.save_person({"name": "Parent", "birth_date": "1990-01-01", "profile_kind": "adult", "relationship": "self"})
            self.assertEqual(adult["relationship"], "self")
            db.save_measurement({"person_id": adult["id"], "measured_at": "2026-10-02T12:00:00Z", "weight_g": 70000})
            with self.assertRaises(ValidationError):
                db.save_feeding({"person_id": adult["id"], "kind": "formula", "started_at": "2026-10-02T12:00:00Z", "volume_ml": 60})


if __name__ == "__main__":
    unittest.main()

