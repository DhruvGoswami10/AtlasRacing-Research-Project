#!/usr/bin/env python3
"""Local post-race survey app for NASA-TLX and trust collection."""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from statistics import mean
from typing import Any
from urllib.parse import unquote


APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
STATIC_DIR = APP_DIR / "static"
TLX_FIELDS = (
    "mentalDemand",
    "physicalDemand",
    "temporalDemand",
    "performance",
    "effort",
    "frustration",
)
PHASE_PATTERN = re.compile(r"Phase-(\d+)")
DIGIT_PATTERN = re.compile(r"(\d+)")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def read_completed_laps(path: Path) -> int:
    if not path.exists():
        return 0

    last_lap = 0
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                lap = int(row.get("lap", "0"))
            except (TypeError, ValueError):
                continue
            last_lap = max(last_lap, lap)
    return last_lap


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def phase_number(name: str) -> int:
    match = PHASE_PATTERN.fullmatch(name)
    return int(match.group(1)) if match else 999


def participant_sort_key(value: str) -> tuple[int, str]:
    match = DIGIT_PATTERN.search(value)
    return (int(match.group(1)) if match else 0, value)


def participant_display(summary: dict[str, Any], phase: str) -> str:
    participant_id = summary.get("participantId")
    if participant_id:
        return participant_id
    if phase == "Phase-1":
        return "S1"
    return f"S{summary.get('seasonNumber', '?')}"


def relative_str(path: Path) -> str:
    return path.relative_to(ROOT_DIR).as_posix()


def format_lap_time(milliseconds: int) -> str:
    minutes, remainder = divmod(int(milliseconds), 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{minutes}:{seconds:02d}.{millis:03d}"


@dataclass
class RaceRecord:
    race_id: str
    phase: str
    phase_number: int
    participant_id: str
    condition: str
    track: str
    date: str
    race_number: int
    total_laps: int
    starting_position: int
    finish_position: int
    points: int
    fastest_lap: bool
    best_lap_ms: int
    avg_lap_ms: int
    pit_stops: list[dict[str, Any]]
    total_pit_stops: int
    weather_changes: list[dict[str, Any]]
    safety_cars: int
    virtual_safety_cars: int
    llm_total_calls: int
    llm_avg_latency_ms: int
    llm_strategy_commits: int
    llm_strategy_amends: int
    llm_ers_calls: int
    llm_driver_questions: int
    followed_rate: int
    completed_laps: int
    notes: str
    summary_path: Path
    survey_path: Path
    survey: dict[str, Any] | None

    def to_list_item(self) -> dict[str, Any]:
        return {
            "raceId": self.race_id,
            "phase": self.phase,
            "phaseNumber": self.phase_number,
            "participantId": self.participant_id,
            "condition": self.condition,
            "track": self.track,
            "date": self.date,
            "raceNumber": self.race_number,
            "startingPosition": self.starting_position,
            "finishPosition": self.finish_position,
            "points": self.points,
            "positionDelta": self.position_delta(),
            "completedLaps": self.completed_laps,
            "lapProgress": self.lap_progress(),
            "didFinish": self.did_finish(),
            "hasSurvey": self.survey is not None,
            "submittedAt": self.survey.get("submittedAt") if self.survey else None,
            "rawTlx": self.survey.get("nasaTlx", {}).get("rawTlx") if self.survey else None,
            "trustInAIRaceEngineer": self.survey.get("trust", {}).get("trustInAIRaceEngineer") if self.survey else None,
            "summaryPath": relative_str(self.summary_path),
            "surveyPath": relative_str(self.survey_path),
        }

    def position_delta(self) -> int:
        return self.starting_position - self.finish_position

    def lap_progress(self) -> str:
        return f"{self.completed_laps} / {self.total_laps}"

    def did_finish(self) -> bool:
        return self.completed_laps >= self.total_laps

    def recap_headline(self) -> str:
        delta = self.position_delta()
        if delta > 0:
            movement = f"Gained {delta} places"
        elif delta < 0:
            movement = f"Lost {abs(delta)} places"
        else:
            movement = "Held the starting position"

        headline = (
            f"Started P{self.starting_position}, finished P{self.finish_position}, "
            f"and scored {self.points} point{'s' if self.points != 1 else ''}. {movement}."
        )
        headline += f" Completed {self.completed_laps} of {self.total_laps} laps."
        if not self.did_finish():
            headline += " Did not reach the full distance."
        if self.fastest_lap:
            headline += " Logged the fastest lap."
        return headline

    def recap_cards(self) -> list[dict[str, str]]:
        delta = self.position_delta()
        delta_value = f"+{delta}" if delta > 0 else str(delta)
        weather_value = str(len(self.weather_changes)) if self.weather_changes else "Stable"
        return [
            {"label": "Position swing", "value": delta_value},
            {"label": "Laps completed", "value": self.lap_progress()},
            {"label": "Best lap", "value": format_lap_time(self.best_lap_ms)},
            {"label": "Average lap", "value": format_lap_time(self.avg_lap_ms)},
            {"label": "Pit stops", "value": str(self.total_pit_stops)},
            {"label": "SC / VSC", "value": f"{self.safety_cars} / {self.virtual_safety_cars}"},
            {"label": "Weather changes", "value": weather_value},
        ]

    def key_moments(self) -> list[str]:
        moments = [
            (
                f"Net result: P{self.starting_position} to P{self.finish_position}, "
                f"with {self.completed_laps} of {self.total_laps} laps completed."
            ),
            (
                f"Best lap was {format_lap_time(self.best_lap_ms)} and the average lap "
                f"was {format_lap_time(self.avg_lap_ms)}."
            ),
        ]

        if self.did_finish():
            moments.append("The race distance was completed in full.")
        else:
            moments.append("The race ended before the full scheduled distance was completed.")

        if self.fastest_lap:
            moments.append("This run included the session's fastest lap.")

        if self.total_pit_stops:
            moments.append(
                f"The race used {self.total_pit_stops} pit stop"
                f"{'s' if self.total_pit_stops != 1 else ''}."
            )
        else:
            moments.append("No pit stops were recorded in the summary.")

        if self.safety_cars or self.virtual_safety_cars:
            moments.append(
                f"Neutralization count: {self.safety_cars} safety car and "
                f"{self.virtual_safety_cars} virtual safety car period"
                f"{'s' if self.virtual_safety_cars != 1 else ''}."
            )

        if self.weather_changes:
            first_change = self.weather_changes[0]
            last_change = self.weather_changes[-1]
            moments.append(
                f"Weather changed {len(self.weather_changes)} times, from "
                f"{first_change['from']} -> {first_change['to']} at lap {first_change['lap']} "
                f"through {last_change['from']} -> {last_change['to']} at lap {last_change['lap']}."
            )

        return moments

    def strategy_timeline(self) -> list[str]:
        timeline_events: list[tuple[int, int, str]] = []

        for stop in self.pit_stops:
            timeline_events.append(
                (
                    int(stop["lap"]),
                    0,
                    (
                        f"Lap {stop['lap']}: pit stop {stop['compoundFrom']} -> {stop['compoundTo']}, "
                        f"P{stop['positionBefore']} to P{stop['positionAfter']} after the stop."
                    ),
                )
            )

        for change in self.weather_changes:
            timeline_events.append(
                (
                    int(change["lap"]),
                    1,
                    f"Lap {change['lap']}: weather changed {change['from']} -> {change['to']}.",
                )
            )

        if not timeline_events:
            return ["No pit, weather, or caution events were logged in the race summary."]

        return [item[2] for item in sorted(timeline_events, key=lambda item: (item[0], item[1]))]

    def to_detail(self) -> dict[str, Any]:
        return {
            **self.to_list_item(),
            "notes": self.notes,
            "totalLaps": self.total_laps,
            "fastestLap": self.fastest_lap,
            "bestLapMs": self.best_lap_ms,
            "avgLapMs": self.avg_lap_ms,
            "pitStops": self.pit_stops,
            "totalPitStops": self.total_pit_stops,
            "weatherChanges": self.weather_changes,
            "safetyCars": self.safety_cars,
            "virtualSafetyCars": self.virtual_safety_cars,
            "llmTotalCalls": self.llm_total_calls,
            "llmAvgLatencyMs": self.llm_avg_latency_ms,
            "llmStrategyCommits": self.llm_strategy_commits,
            "llmStrategyAmends": self.llm_strategy_amends,
            "llmERSCalls": self.llm_ers_calls,
            "llmDriverQuestions": self.llm_driver_questions,
            "followedRate": self.followed_rate,
            "completedLaps": self.completed_laps,
            "lapProgress": self.lap_progress(),
            "didFinish": self.did_finish(),
            "recap": {
                "headline": self.recap_headline(),
                "cards": self.recap_cards(),
                "keyMoments": self.key_moments(),
                "strategyTimeline": self.strategy_timeline(),
            },
            "survey": self.survey,
        }


class SurveyStore:
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self.records: dict[str, RaceRecord] = {}
        self.order: list[str] = []
        self.refresh()

    def refresh(self) -> None:
        records: dict[str, RaceRecord] = {}
        order: list[tuple[tuple[int, tuple[int, str], int, str], str]] = []

        for phase_dir in sorted(self.root_dir.glob("Phase-*"), key=lambda item: phase_number(item.name)):
            if not phase_dir.is_dir():
                continue

            for summary_path in phase_dir.rglob("*_race_summary.json"):
                summary = read_json(summary_path)
                prefix = summary_path.name[: -len("_race_summary.json")]
                survey_path = summary_path.with_name(f"{prefix}_post_race_survey.json")
                telemetry_path = summary_path.with_name(f"{prefix}_lap_telemetry.csv")
                survey = read_json(survey_path) if survey_path.exists() else None
                completed_laps = read_completed_laps(telemetry_path)
                participant_id = participant_display(summary, phase_dir.name)
                race_id = summary["raceId"]

                record = RaceRecord(
                    race_id=race_id,
                    phase=phase_dir.name,
                    phase_number=phase_number(phase_dir.name),
                    participant_id=participant_id,
                    condition=summary["seasonType"],
                    track=summary["track"],
                    date=summary["date"],
                    race_number=summary["raceNumber"],
                    total_laps=summary["totalLaps"],
                    starting_position=summary["startingPosition"],
                    finish_position=summary["finishPosition"],
                    points=summary["points"],
                    fastest_lap=summary["fastestLap"],
                    best_lap_ms=summary["bestLapMs"],
                    avg_lap_ms=summary["avgLapMs"],
                    pit_stops=summary["pitStops"],
                    total_pit_stops=summary["totalPitStops"],
                    weather_changes=summary["weatherChanges"],
                    safety_cars=summary["safetyCars"],
                    virtual_safety_cars=summary["virtualSafetyCars"],
                    llm_total_calls=summary["llmTotalCalls"],
                    llm_avg_latency_ms=summary["llmAvgLatencyMs"],
                    llm_strategy_commits=summary["llmStrategyCommits"],
                    llm_strategy_amends=summary["llmStrategyAmends"],
                    llm_ers_calls=summary["llmERSCalls"],
                    llm_driver_questions=summary["llmDriverQuestions"],
                    followed_rate=summary["followedRate"],
                    completed_laps=completed_laps or summary["totalLaps"],
                    notes=summary.get("notes", ""),
                    summary_path=summary_path,
                    survey_path=survey_path,
                    survey=survey,
                )

                records[race_id] = record
                sort_key = (
                    record.phase_number,
                    participant_sort_key(record.participant_id),
                    record.race_number,
                    record.race_id,
                )
                order.append((sort_key, race_id))

        self.records = records
        self.order = [race_id for _, race_id in sorted(order, key=lambda item: item[0])]

    def list_races(self) -> list[dict[str, Any]]:
        return [self.records[race_id].to_list_item() for race_id in self.order]

    def get_race(self, race_id: str) -> RaceRecord | None:
        return self.records.get(race_id)

    def completed_count(self) -> int:
        return sum(1 for record in self.records.values() if record.survey is not None)

    def export_rows(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for race_id in self.order:
            record = self.records[race_id]
            if not record.survey:
                continue
            survey = record.survey
            rows.append(
                {
                    "phase": record.phase,
                    "participantId": record.participant_id,
                    "raceId": record.race_id,
                    "condition": record.condition,
                    "track": record.track,
                    "raceDate": record.date,
                    "submittedAt": survey.get("submittedAt"),
                    "startingPosition": record.starting_position,
                    "finishPosition": record.finish_position,
                    "points": record.points,
                    **{field: survey["nasaTlx"][field] for field in TLX_FIELDS},
                    "rawTlx": survey["nasaTlx"]["rawTlx"],
                    "trustInAIRaceEngineer": survey["trust"]["trustInAIRaceEngineer"],
                    "recallConfidence": survey["responseQuality"]["recallConfidence"],
                    "comment": survey["openText"]["comment"],
                }
            )
        return rows

    def save_survey(self, race_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        record = self.get_race(race_id)
        if record is None:
            raise KeyError(f"Unknown race: {race_id}")

        survey = validate_payload(record, payload)
        write_json(record.survey_path, survey)
        record.survey = survey
        return survey


def require_int(value: Any, lower: int, upper: int, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer.")
    try:
        numeric = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer.") from exc
    if numeric < lower or numeric > upper:
        raise ValueError(f"{field_name} must be between {lower} and {upper}.")
    return numeric


def validate_payload(record: RaceRecord, payload: dict[str, Any]) -> dict[str, Any]:
    nasa_input = payload.get("nasaTlx", {})
    nasa_values = {
        field: require_int(nasa_input.get(field), 0, 100, field) for field in TLX_FIELDS
    }
    raw_tlx = round(mean(nasa_values.values()), 1)

    response_quality = payload.get("responseQuality", {})
    recall_confidence = require_int(
        response_quality.get("recallConfidence"), 1, 7, "recallConfidence"
    )

    trust_applicable = record.condition == "llm"
    trust_input = payload.get("trust", {})
    trust_value = trust_input.get("trustInAIRaceEngineer")
    if trust_applicable:
        trust_value = require_int(trust_value, 1, 7, "trustInAIRaceEngineer")
    else:
        trust_value = None

    open_text = payload.get("openText", {})
    comment = str(open_text.get("comment", "")).strip()
    if len(comment) > 4000:
        raise ValueError("comment must be at most 4000 characters.")

    return {
        "raceId": record.race_id,
        "participantId": record.participant_id,
        "phase": record.phase,
        "condition": record.condition,
        "track": record.track,
        "timing": "post_race",
        "formVersion": "1.0",
        "submittedAt": utc_now(),
        "nasaTlx": {
            "scale": "0-100",
            **nasa_values,
            "performanceHigherIsWorse": True,
            "rawTlx": raw_tlx,
        },
        "trust": {
            "scale": "1-7",
            "trustApplicable": trust_applicable,
            "trustInAIRaceEngineer": trust_value,
        },
        "responseQuality": {
            "scale": "1-7",
            "recallConfidence": recall_confidence,
        },
        "openText": {
            "comment": comment,
        },
    }


class SurveyRequestHandler(BaseHTTPRequestHandler):
    server_version = "AtlasSurvey/1.0"

    @property
    def store(self) -> SurveyStore:
        return self.server.store  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        if self.path == "/" or self.path.startswith("/static/"):
            self.serve_static()
            return

        if self.path == "/api/races":
            self.send_json({"races": self.store.list_races()})
            return

        if self.path.startswith("/api/races/"):
            race_id = unquote(self.path.removeprefix("/api/races/"))
            record = self.store.get_race(race_id)
            if record is None:
                self.send_error_json(HTTPStatus.NOT_FOUND, "Race not found.")
                return
            self.send_json(record.to_detail())
            return

        if self.path == "/api/export.csv":
            self.send_csv(self.store.export_rows())
            return

        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")

    def do_POST(self) -> None:
        if not self.path.startswith("/api/races/") or not self.path.endswith("/survey"):
            self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")
            return

        race_id = unquote(self.path.removeprefix("/api/races/").removesuffix("/survey"))
        content_length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(content_length) if content_length else b"{}")
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Request body must be valid JSON.")
            return

        try:
            survey = self.store.save_survey(race_id, payload)
        except KeyError:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Race not found.")
            return
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return

        self.send_json({"ok": True, "survey": survey}, status=HTTPStatus.CREATED)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def serve_static(self) -> None:
        request_path = self.path
        if request_path == "/":
            file_path = STATIC_DIR / "index.html"
        else:
            relative = request_path.removeprefix("/static/")
            file_path = (STATIC_DIR / relative).resolve()
            if not str(file_path).startswith(str(STATIC_DIR.resolve())):
                self.send_error_json(HTTPStatus.FORBIDDEN, "Invalid path.")
                return

        if not file_path.exists() or not file_path.is_file():
            self.send_error_json(HTTPStatus.NOT_FOUND, "Static asset not found.")
            return

        data = file_path.read_bytes()
        mime_type, _ = mimetypes.guess_type(file_path.name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"error": message}, status=status)

    def send_csv(self, rows: list[dict[str, Any]]) -> None:
        fieldnames = [
            "phase",
            "participantId",
            "raceId",
            "condition",
            "track",
            "raceDate",
            "submittedAt",
            "startingPosition",
            "finishPosition",
            "points",
            *TLX_FIELDS,
            "rawTlx",
            "trustInAIRaceEngineer",
            "recallConfidence",
            "comment",
        ]

        from io import StringIO

        buffer = StringIO()
        writer = csv.DictWriter(buffer, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        data = buffer.getvalue().encode("utf-8")

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="post_race_surveys.csv"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class SurveyHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], store: SurveyStore):
        super().__init__(server_address, SurveyRequestHandler)
        self.store = store


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Atlas Racing survey capture app.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to.")
    parser.add_argument("--port", default=8765, type=int, help="Port to bind to.")
    parser.add_argument(
        "--scan-only",
        action="store_true",
        help="Print the scan summary and exit without starting the server.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    store = SurveyStore(ROOT_DIR)

    if args.scan_only:
        print(f"Total races: {len(store.records)}")
        print(f"Completed surveys: {store.completed_count()}")
        print(f"Pending surveys: {len(store.records) - store.completed_count()}")
        return

    server = SurveyHTTPServer((args.host, args.port), store)
    print(f"Atlas survey app running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
