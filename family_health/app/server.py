"""Private Home Assistant ingress UI and JSON API for Family Health."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from db import FamilyDatabase, ValidationError

DATABASE_PATH = Path(os.environ.get("FAMILY_HEALTH_DB", "/share/home_apps.sqlite3"))
PORT = int(os.environ.get("FAMILY_HEALTH_PORT", "8099"))
ASSETS = Path(__file__).parent
database = None


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status, content_type, length):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'")
        self.end_headers()

    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        if not isinstance(body, bytes):
            body = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self._headers(status, content_type, len(body))
        self.wfile.write(body)

    def _error(self, status, message):
        self._send(status, {"error": message})

    def _body(self):
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            raise ValidationError("Send JSON content")
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                raise ValidationError("Request body must be 1–16384 bytes")
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValidationError("Request body must be an object")
            return body
        except (ValueError, json.JSONDecodeError) as exc:
            raise ValidationError("Invalid JSON body") from exc

    def _handle(self, method):
        global database
        path = urlparse(self.path).path
        parts = [part for part in path.split("/") if part]
        try:
            if method == "GET" and path in ("/", "/index.html", "/app.js", "/style.css"):
                filename = "index.html" if path == "/" else path.removeprefix("/")
                mime = "text/html" if filename.endswith("html") else "text/javascript" if filename.endswith("js") else "text/css"
                self._send(200, (ASSETS / filename).read_bytes(), f"{mime}; charset=utf-8")
                return
            if not parts or parts[0] != "api":
                return self._error(404, "Not found")
            if method == "GET" and parts == ["api", "people"]:
                return self._send(200, {"people": database.people()})
            if method == "POST" and parts == ["api", "people"]:
                return self._send(201, database.save_person(self._body()))
            if method == "PUT" and len(parts) == 3 and parts[1] == "people":
                return self._send(200, database.save_person(self._body(), parts[2]))
            if method == "GET" and parts == ["api", "feedings"]:
                person_id = parse_qs(urlparse(self.path).query).get("person_id", [None])[0]
                return self._send(200, {"feedings": database.feedings(person_id)})
            if method == "POST" and parts == ["api", "feedings"]:
                return self._send(201, database.save_feeding(self._body()))
            if method == "PUT" and len(parts) == 3 and parts[1] == "feedings":
                return self._send(200, database.save_feeding(self._body(), parts[2]))
            if method == "DELETE" and len(parts) == 3 and parts[1] == "feedings":
                database.delete("family_feedings", parts[2])
                return self._send(200, {"deleted": True})
            if method == "GET" and parts == ["api", "measurements"]:
                person_id = parse_qs(urlparse(self.path).query).get("person_id", [None])[0]
                return self._send(200, {"measurements": database.measurements(person_id)})
            if method == "POST" and parts == ["api", "measurements"]:
                return self._send(201, database.save_measurement(self._body()))
            if method == "PUT" and len(parts) == 3 and parts[1] == "measurements":
                return self._send(200, database.save_measurement(self._body(), parts[2]))
            if method == "DELETE" and len(parts) == 3 and parts[1] == "measurements":
                database.delete("family_measurements", parts[2])
                return self._send(200, {"deleted": True})
            self._error(404, "Not found")
        except ValidationError as exc:
            self._error(400, str(exc))
        except KeyError as exc:
            self._error(404, str(exc).strip("'"))
        except sqlite3.IntegrityError:
            self._error(400, "Record could not be saved")
        except Exception:
            logging.exception("Request failed")
            self._error(500, "Unexpected server error")

    def do_GET(self):  # noqa: N802
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_PUT(self):  # noqa: N802
        self._handle("PUT")

    def do_DELETE(self):  # noqa: N802
        self._handle("DELETE")


def main():
    global database
    logging.basicConfig(level=logging.INFO)
    database = FamilyDatabase(DATABASE_PATH)
    logging.info("Family Health ready on port %s, schema version 1", PORT)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

