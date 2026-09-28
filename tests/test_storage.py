import json
import os

from tracker.storage import SCHEMA, Store


def write(path, name, data):
    with open(os.path.join(path, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f)


def test_fresh_store(tmp_path):
    store = Store(str(tmp_path / "db"))
    assert store.data["meta"]["schema"] == SCHEMA
    assert store.data["matches"] == {}
    assert os.path.exists(tmp_path / "db" / "meta.json")


def test_migrates_v1_split_files(tmp_path):
    db = tmp_path / "db"
    db.mkdir()
    write(db, "matches", {"m1": {"queue": "competitive", "won": True, "my_score": 13, "enemy_score": 7, "start_time": 5,
                            "scoreboard": [{"puuid": "me", "is_me": True, "team": "Blue", "score": 4000}]}})
    write(db, "processed_matches", ["m1", "custom1"])
    write(db, "skins", {"W": {"S": {"queues": {"competitive": {"kills": 13, "hs_kills": 2, "matches": 5, "wins": 3}}}}})
    write(db, "player_stats", {"user_profile": {"name": "Pseudo#EUW", "rank": 15, "level": 80}, "queues": {}})
    write(db, "agents", {})
    write(db, "locked_loadouts", {"m1": {"w": "s"}})

    store = Store(str(db))
    m = store.data["matches"]["m1"]
    assert m["v"] == 1 and m["start"] == 5 and m["result"] == "win" and m["rounds"] == 20
    assert m["acs"] == 200 and m["scoreboard"][0]["acs"] == 200 and m["team"] == "Blue"
    assert store.data["meta"]["skipped"] == ["custom1"]
    assert store.data["legacy"]["skins"] == {"w": {"s": {"competitive": {"kills": 13, "matches": 5, "wins": 3}}}}
    assert (store.data["profile"]["name"], store.data["profile"]["tag"]) == ("Pseudo", "EUW")
    assert store.data["locked_loadouts"] == {"m1": {"w": "s"}}
    assert store.processed_ids() == {"m1", "custom1"}
    # v1-only files are moved to a backup folder, never deleted
    assert not os.path.exists(db / "skins.json")
    backups = [d for d in os.listdir(db) if d.startswith("backup-v1-")]
    assert backups and os.path.exists(db / backups[0] / "skins.json")

    # Reloading doesn't migrate twice
    again = Store(str(db))
    assert again.data["matches"]["m1"]["v"] == 1


def test_migrates_single_database_json(tmp_path):
    with open(tmp_path / "database.json", "w", encoding="utf-8") as f:
        json.dump({"processed_matches": ["a"], "matches": {}, "skins": {}}, f)
    store = Store(str(tmp_path / "db"))
    assert store.data["meta"]["skipped"] == ["a"]
    assert os.path.exists(tmp_path / "database.json.bak")


def test_corrupted_file_is_kept(tmp_path):
    db = tmp_path / "db"
    db.mkdir()
    (db / "matches.json").write_text("{not json", encoding="utf-8")
    store = Store(str(db))
    assert store.data["matches"] == {}
    assert any(n.startswith("matches.json.corrupt-") for n in os.listdir(db))


def test_snapshots_and_loadout_lookup(tmp_path):
    store = Store(str(tmp_path / "db"))
    assert store.loadout_at(10) == (None, "unknown")
    assert store.add_snapshot({"w": {"skin": "a", "chroma": ""}}, ts=1)
    assert not store.add_snapshot({"w": {"skin": "a", "chroma": ""}}, ts=2)
    assert store.add_snapshot({"w": {"skin": "b", "chroma": ""}}, ts=3)
    assert store.loadout_at(2500) == ({"w": "a"}, "snapshot")
    assert store.loadout_at(5000) == ({"w": "b"}, "snapshot")
    assert store.loadout_at(0) == ({"w": "a"}, "estimated")


def test_save_is_atomic_and_roundtrips(tmp_path):
    store = Store(str(tmp_path / "db"))
    store.data["matches"]["x"] = {"id": "x", "v": 2}
    store.mark("matches")
    v = store.matches_version
    store.save()
    assert v >= 1
    assert not any(n.endswith(".tmp") for n in os.listdir(tmp_path / "db"))
    assert Store(str(tmp_path / "db")).data["matches"]["x"]["v"] == 2
