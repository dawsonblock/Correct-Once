from effect_fabric.qualification.dao_engine_shadow import (
    DaoEngineInvariantShadow,
    DaoEngineShadowError,
    project_action,
)
from effect_fabric.reducer import ReducerExecution, RequestDisposition


def action(
    status: str,
    *,
    revision: int = 1,
    epoch: int = 0,
    attempted: bool = False,
):
    return {
        "id": "a1",
        "intent": {"subject": "s1"},
        "idempotencyKey": "idem-1",
        "seq": 1,
        "status": status,
        "revision": revision,
        "epoch": epoch,
        "attempted": attempted,
        "attempts": 1 if attempted else 0,
    }


def audit(*transitions: tuple[str | None, str]) -> list[dict[str, object]]:
    return [
        {"seq": index, "from": source, "to": target}
        for index, (source, target) in enumerate(transitions, start=1)
    ]


def test_projection_keeps_execution_and_disposition_orthogonal() -> None:
    projection = project_action(action("EXECUTED_THEN_WITHDRAWN", attempted=True))
    assert projection.execution == ReducerExecution.RECEIPT_RECORDED
    assert projection.disposition == RequestDisposition.EFFECT_THEN_WITHDRAWN
    assert projection.crossed is True


def test_shadow_accepts_started_unknown_receipt_path() -> None:
    shadow = DaoEngineInvariantShadow()
    shadow.observe([action("READY")], audit((None, "READY")))
    shadow.observe(
        [action("LEASED", revision=2, epoch=1)],
        audit((None, "READY"), ("READY", "LEASED")),
    )
    shadow.observe(
        [action("ATTEMPTING", revision=3, epoch=1, attempted=True)],
        audit((None, "READY"), ("READY", "LEASED"), ("LEASED", "ATTEMPTING")),
    )
    shadow.observe(
        [action("IN_DOUBT", revision=4, epoch=1, attempted=True)],
        audit(
            (None, "READY"),
            ("READY", "LEASED"),
            ("LEASED", "ATTEMPTING"),
            ("ATTEMPTING", "IN_DOUBT"),
        ),
    )
    shadow.observe(
        [action("EXECUTED", revision=5, epoch=1, attempted=True)],
        audit(
            (None, "READY"),
            ("READY", "LEASED"),
            ("LEASED", "ATTEMPTING"),
            ("ATTEMPTING", "IN_DOUBT"),
            ("IN_DOUBT", "EXECUTED"),
        ),
    )
    shadow.observe(
        [action("ACKED", revision=6, epoch=1, attempted=True)],
        audit(
            (None, "READY"),
            ("READY", "LEASED"),
            ("LEASED", "ATTEMPTING"),
            ("ATTEMPTING", "IN_DOUBT"),
            ("IN_DOUBT", "EXECUTED"),
            ("EXECUTED", "ACKED"),
        ),
    )
    assert shadow.observations == 6


def test_shadow_rejects_terminal_mutation() -> None:
    shadow = DaoEngineInvariantShadow()
    shadow.observe(
        [action("ACKED", revision=6, epoch=1, attempted=True)],
        audit((None, "READY")),
    )
    bad = action("ACKED", revision=7, epoch=1, attempted=True)
    try:
        shadow.observe([bad], audit((None, "READY")))
    except DaoEngineShadowError as exc:
        assert "terminal action" in str(exc)
    else:
        raise AssertionError("expected terminal mutation rejection")


def test_shadow_rejects_idempotency_key_drift() -> None:
    shadow = DaoEngineInvariantShadow()
    shadow.observe([action("READY")], audit((None, "READY")))
    bad = action("LEASED", revision=2, epoch=1)
    bad["idempotencyKey"] = "changed"
    try:
        shadow.observe(
            [bad],
            audit((None, "READY"), ("READY", "LEASED")),
        )
    except DaoEngineShadowError as exc:
        assert "idempotency key" in str(exc)
    else:
        raise AssertionError("expected idempotency drift rejection")
