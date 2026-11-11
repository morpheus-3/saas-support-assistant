"""Small SQLite store for the single-tenant local demo.

Production deployments must add authenticated tenant ownership before exposing IDs.
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _connect():
    path = Path(os.getenv("DATABASE_PATH", Path(__file__).parent.parent / "data" / "assistant.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.row_factory = sqlite3.Row
    return connection


def initialize():
    with _connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL, content TEXT NOT NULL, status TEXT, sources TEXT NOT NULL DEFAULT '[]',
          citations TEXT NOT NULL DEFAULT '[]', confidence REAL, latency_ms REAL,
          prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, estimated_cost_usd REAL,
          relevance REAL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feedback (
          message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
          vote TEXT NOT NULL CHECK(vote IN ('helpful','not_helpful')), created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS escalations (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          question TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, latency_ms REAL, prompt_tokens INTEGER,
          completion_tokens INTEGER, total_tokens INTEGER, estimated_cost_usd REAL,
          relevance REAL, created_at TEXT NOT NULL
        );
        """)


def _now():
    return datetime.now(timezone.utc).isoformat()


def create_conversation(title="New conversation"):
    initialize()
    conversation_id, now = str(uuid.uuid4()), _now()
    with _connect() as db:
        db.execute("INSERT INTO conversations VALUES (?, ?, ?, ?)", (conversation_id, title[:120], now, now))
    return conversation_id


def save_message(conversation_id, role, content, **metadata):
    initialize()
    message_id, now = str(uuid.uuid4()), _now()
    with _connect() as db:
        if not db.execute("SELECT 1 FROM conversations WHERE id=?", (conversation_id,)).fetchone():
            raise KeyError("Conversation not found")
        db.execute("""INSERT INTO messages
          (id,conversation_id,role,content,status,sources,citations,confidence,latency_ms,
           prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,relevance,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (message_id, conversation_id, role, content, metadata.get("status"),
           json.dumps(metadata.get("sources", [])), json.dumps(metadata.get("citations", [])),
           metadata.get("confidence"), metadata.get("latency_ms"), metadata.get("prompt_tokens"),
           metadata.get("completion_tokens"), metadata.get("total_tokens"), metadata.get("estimated_cost_usd"),
           metadata.get("relevance"), now))
        db.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now, conversation_id))
    return message_id


def list_conversations():
    initialize()
    with _connect() as db:
        return [dict(row) for row in db.execute("SELECT c.*, (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id) AS message_count FROM conversations c ORDER BY updated_at DESC")]


def get_conversation(conversation_id):
    initialize()
    with _connect() as db:
        conversation = db.execute("SELECT * FROM conversations WHERE id=?", (conversation_id,)).fetchone()
        if not conversation:
            return None
        messages = [dict(row) for row in db.execute("""SELECT m.*, f.vote AS feedback FROM messages m
          LEFT JOIN feedback f ON f.message_id=m.id WHERE m.conversation_id=? ORDER BY m.created_at""", (conversation_id,))]
    for message in messages:
        message["sources"] = json.loads(message["sources"])
        message["citations"] = json.loads(message["citations"])
    return {**dict(conversation), "messages": messages}


def delete_conversation(conversation_id):
    initialize()
    with _connect() as db:
        db.execute("PRAGMA foreign_keys=ON")
        return db.execute("DELETE FROM conversations WHERE id=?", (conversation_id,)).rowcount > 0


def save_feedback(message_id, vote):
    initialize()
    with _connect() as db:
        if not db.execute("SELECT 1 FROM messages WHERE id=? AND role='assistant'", (message_id,)).fetchone():
            return False
        db.execute("INSERT INTO feedback VALUES (?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET vote=excluded.vote, created_at=excluded.created_at", (message_id, vote, _now()))
    return True


def create_escalation(conversation_id, question):
    initialize()
    escalation_id = str(uuid.uuid4())
    with _connect() as db:
        if not db.execute("SELECT 1 FROM conversations WHERE id=?", (conversation_id,)).fetchone():
            raise KeyError("Conversation not found")
        db.execute("INSERT INTO escalations VALUES (?, ?, ?, 'open', ?)", (escalation_id, conversation_id, question, _now()))
    return escalation_id


def record_event(kind, **metrics):
    initialize()
    with _connect() as db:
        db.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          (str(uuid.uuid4()), kind, metrics.get("latency_ms"), metrics.get("prompt_tokens"), metrics.get("completion_tokens"),
           metrics.get("total_tokens"), metrics.get("estimated_cost_usd"), metrics.get("relevance"), _now()))


def metrics():
    initialize()
    with _connect() as db:
        row = db.execute("""SELECT count(*) total, sum(kind='answered') answered, sum(kind='not_found') not_found,
          sum(kind='failure') failures, avg(latency_ms) avg_latency_ms, sum(total_tokens) total_tokens,
          sum(estimated_cost_usd) estimated_cost_usd, avg(relevance) avg_relevance FROM events""").fetchone()
        feedback = dict(db.execute("SELECT vote,count(*) count FROM feedback GROUP BY vote").fetchall())
        escalations = [dict(r) for r in db.execute("SELECT id,conversation_id,question,status,created_at FROM escalations ORDER BY created_at DESC LIMIT 20")]
    result = dict(row)
    result["estimated_cost_usd"] = round(result["estimated_cost_usd"] or 0, 6)
    result["feedback"] = {"helpful": feedback.get("helpful", 0), "not_helpful": feedback.get("not_helpful", 0)}
    result["escalations"] = escalations
    return result


def reset_metrics():
    """Clear aggregate request telemetry without deleting chats, feedback, or tickets."""
    initialize()
    with _connect() as db:
        db.execute("DELETE FROM events")

