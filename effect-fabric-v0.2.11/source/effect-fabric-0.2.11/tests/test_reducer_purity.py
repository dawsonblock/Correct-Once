from pathlib import Path


def test_reducer_has_no_runtime_side_effect_primitives():
    source = (Path(__file__).parents[1] / "src/effect_fabric/reducer.py").read_text()
    forbidden = (
        "datetime.now",
        "time.time",
        "random.",
        "secrets.",
        "os.environ",
        "subprocess",
        "socket",
        "requests",
        "httpx",
        "open(",
        "Path(",
        "uuid4",
    )
    assert all(token not in source for token in forbidden)
