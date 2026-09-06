from __future__ import annotations

import asyncio
import http.client
import json
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from enum import StrEnum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from ..canonical import digest_document
from ..errors import (
    AmbiguousEffectError,
    ProviderErrorKind,
    ProviderExecutionError,
    VerifierErrorKind,
    VerifierObservationError,
)
from ..interfaces import EffectExecutor, EffectVerifier
from ..models import (
    ActionIntent,
    EffectContract,
    ExecutionAttempt,
    Observation,
    PreparedEffect,
    ProviderReceipt,
    ReconciliationStatus,
)


class QualificationScenario(StrEnum):
    SUCCESS = "success"
    MUTATE_THEN_DROP = "mutate_then_drop"
    DROP_BEFORE_MUTATE = "drop_before_mutate"
    DEFINITIVE_REJECTION = "definitive_rejection"
    PRE_EFFECT_UNAVAILABLE = "pre_effect_unavailable"
    RATE_LIMITED = "rate_limited"
    PROTOCOL_VIOLATION_AFTER_MUTATION = "protocol_violation_after_mutation"
    EVENTUAL_VISIBILITY = "eventual_visibility"
    VERIFIER_UNAVAILABLE = "verifier_unavailable"
    THIRD_PARTY_DRIFT = "third_party_drift"


@dataclass
class _ProviderState:
    scenario: QualificationScenario = QualificationScenario.SUCCESS
    value: str = "initial"
    visible_value: str = "initial"
    version: int = 0
    prior_visible_value: str = "initial"
    pending_visibility_reads: int = 0
    mutation_count: int = 0
    observation_count: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def mutate(self, value: str) -> None:
        self.prior_visible_value = self.visible_value
        self.value = value
        self.version += 1
        self.mutation_count += 1
        if self.scenario == QualificationScenario.EVENTUAL_VISIBILITY:
            self.pending_visibility_reads = 2
        elif self.scenario == QualificationScenario.THIRD_PARTY_DRIFT:
            self.visible_value = f"drifted:{value}"
        else:
            self.visible_value = value


class _Handler(BaseHTTPRequestHandler):
    server_version = "EffectFabricQualification/0.2.11"

    @property
    def state(self) -> _ProviderState:
        return self.server.provider_state  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _json(
        self,
        status: int,
        body: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> None:
        raw = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def _drop(self) -> None:
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/state":
            self._json(404, {"error": "not_found"})
            return
        authoritative = urllib.parse.parse_qs(parsed.query).get("authoritative") == ["1"]
        with self.state.lock:
            self.state.observation_count += 1
            if (
                self.state.scenario == QualificationScenario.VERIFIER_UNAVAILABLE
                and not authoritative
                and self.state.mutation_count > 0
            ):
                self._json(503, {"error": "verifier_unavailable"}, {"Retry-After": "0"})
                return

            if authoritative:
                value = self.state.value
                pending = False
            elif self.state.pending_visibility_reads > 0:
                value = self.state.prior_visible_value
                self.state.pending_visibility_reads -= 1
                pending = True
                if self.state.pending_visibility_reads == 0:
                    self.state.visible_value = self.state.value
            else:
                value = self.state.visible_value
                pending = False
            headers = {
                "ETag": f'"v{self.state.version}"',
                "X-Effect-Consistency": "pending" if pending else "stable",
            }
            self._json(200, {"value": value, "version": self.state.version}, headers)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/mutate":
            self._json(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            value = str(body["value"])
        except Exception:
            self._json(400, {"error": "invalid_request"}, {"X-Effect-Not-Applied": "true"})
            return

        with self.state.lock:
            scenario = self.state.scenario
            if scenario == QualificationScenario.DEFINITIVE_REJECTION:
                self._json(409, {"error": "rejected"}, {"X-Effect-Not-Applied": "true"})
                return
            if scenario == QualificationScenario.PRE_EFFECT_UNAVAILABLE:
                self._json(
                    503,
                    {"error": "unavailable_before_effect"},
                    {"X-Effect-Not-Applied": "true", "Retry-After": "0"},
                )
                return
            if scenario == QualificationScenario.RATE_LIMITED:
                self._json(
                    429,
                    {"error": "rate_limited"},
                    {"X-Effect-Not-Applied": "true", "Retry-After": "0"},
                )
                return
            if scenario == QualificationScenario.DROP_BEFORE_MUTATE:
                self._drop()
                return

            self.state.mutate(value)
            if scenario == QualificationScenario.MUTATE_THEN_DROP:
                self._drop()
                return
            if scenario == QualificationScenario.PROTOCOL_VIOLATION_AFTER_MUTATION:
                self._json(202, {"applied": True, "value": value})
                return
            self._json(200, {"applied": True, "value": value, "version": self.state.version})


class QualificationProviderServer:
    """Local HTTP provider with deterministic adverse scenarios.

    It is a qualification instrument, not a production provider.
    """

    def __init__(
        self,
        scenario: QualificationScenario = QualificationScenario.SUCCESS,
        *,
        initial_value: str = "initial",
    ):
        self.state = _ProviderState(
            scenario=scenario,
            value=initial_value,
            visible_value=initial_value,
            prior_visible_value=initial_value,
        )
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._server.provider_state = self.state  # type: ignore[attr-defined]
        self._thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    def start(self) -> QualificationProviderServer:
        if self._thread is None:
            self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
            self._thread.start()
        return self

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def __enter__(self) -> QualificationProviderServer:
        return self.start()

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()


@dataclass(frozen=True)
class QualificationProviderConfig:
    api_base: str
    timeout_seconds: float = 2.0


class _HTTP:
    def __init__(self, config: QualificationProviderConfig):
        self.config = config

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> tuple[int, Any, dict[str, str]]:
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            self.config.api_base.rstrip("/") + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        with urllib.request.urlopen(request, timeout=self.config.timeout_seconds) as response:
            raw = response.read()
            body = json.loads(raw) if raw else None
            return response.status, body, dict(response.headers)

    async def request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> tuple[int, Any, dict[str, str]]:
        return await asyncio.to_thread(self._request, method, path, payload)


def _execution_http_error(exc: urllib.error.HTTPError) -> ProviderExecutionError:
    status = int(exc.code)
    headers = dict(exc.headers or {})
    no_effect = headers.get("X-Effect-Not-Applied", "").lower() == "true"
    metadata = {"status_code": status, "retry_after": headers.get("Retry-After")}
    if status == 429 and no_effect:
        return ProviderExecutionError(
            "qualification provider rate limited before applying the effect",
            kind=ProviderErrorKind.RATE_LIMITED,
            may_have_happened=False,
            safe_to_retry=True,
            metadata=metadata,
        )
    if status == 503 and no_effect:
        return ProviderExecutionError(
            "qualification provider unavailable before applying the effect",
            kind=ProviderErrorKind.RETRYABLE_PRE_EFFECT,
            may_have_happened=False,
            safe_to_retry=True,
            metadata=metadata,
        )
    if 400 <= status < 500 and no_effect:
        return ProviderExecutionError(
            f"qualification provider definitively rejected request with HTTP {status}",
            kind=ProviderErrorKind.DEFINITIVE_REJECTION,
            may_have_happened=False,
            safe_to_retry=False,
            metadata=metadata,
        )
    return ProviderExecutionError(
        f"qualification provider returned ambiguous HTTP {status}",
        kind=ProviderErrorKind.PROVIDER_UNAVAILABLE,
        may_have_happened=True,
        safe_to_retry=False,
        metadata=metadata,
    )


class QualificationProviderExecutor(EffectExecutor):
    name = "qualification-provider"

    def __init__(self, config: QualificationProviderConfig):
        self.http = _HTTP(config)

    async def prepare(self, intent: ActionIntent, contract: EffectContract) -> PreparedEffect:
        del intent, contract
        status, body, headers = await self.http.request("GET", "/state?authoritative=1")
        if status != 200 or not isinstance(body, dict):
            raise RuntimeError("qualification provider pre-state unavailable")
        return PreparedEffect(
            observed_pre_state={"value": body.get("value"), "version": body.get("version")},
            external_version=headers.get("ETag"),
        )

    async def execute(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ProviderReceipt:
        del prepared
        if intent.operation != "qualification.state.set":
            raise ValueError(f"unsupported operation: {intent.operation}")
        value = str(intent.arguments["value"])
        try:
            status, body, _ = await self.http.request("POST", "/mutate", {"value": value})
        except urllib.error.HTTPError as exc:
            raise _execution_http_error(exc) from exc
        except (
            TimeoutError,
            ConnectionError,
            urllib.error.URLError,
            http.client.RemoteDisconnected,
            ConnectionResetError,
        ) as exc:
            raise AmbiguousEffectError(
                "qualification provider mutation response was lost",
                metadata={"error_type": type(exc).__name__},
            ) from exc

        if status != 200 or not isinstance(body, dict) or body.get("applied") is not True:
            raise ProviderExecutionError(
                "qualification provider violated its success protocol after mutation",
                kind=ProviderErrorKind.PROTOCOL_VIOLATION,
                may_have_happened=True,
                safe_to_retry=False,
                metadata={"status_code": status},
            )
        return ProviderReceipt(
            provider="qualification",
            operation=intent.operation,
            external_id=attempt.attempt_id,
            status_code=status,
            idempotency_key=intent.intent_id,
            response_digest=digest_document(body),
            metadata={"provider_version": "qualification/v1"},
        )

    async def reconcile(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ReconciliationStatus:
        del prepared, attempt
        try:
            status, body, _ = await self.http.request("GET", "/state?authoritative=1")
        except Exception:
            return ReconciliationStatus.UNKNOWN
        if status != 200 or not isinstance(body, dict):
            return ReconciliationStatus.UNKNOWN
        return (
            ReconciliationStatus.HAPPENED
            if str(body.get("value")) == str(intent.arguments["value"])
            else ReconciliationStatus.NOT_HAPPENED
        )


class QualificationProviderVerifier(EffectVerifier):
    name = "qualification-provider-verifier"

    def __init__(self, config: QualificationProviderConfig):
        self.http = _HTTP(config)

    async def observe(self, intent: ActionIntent, contract: EffectContract) -> Observation:
        del contract
        try:
            status, body, headers = await self.http.request("GET", "/state")
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            if status in {429, 503}:
                raise VerifierObservationError(
                    f"qualification provider observation unavailable with HTTP {status}",
                    kind=(
                        VerifierErrorKind.RATE_LIMITED
                        if status == 429
                        else VerifierErrorKind.PROVIDER_UNAVAILABLE
                    ),
                    retryable=True,
                    metadata={"status_code": status},
                ) from exc
            raise VerifierObservationError(
                f"qualification provider observation rejected with HTTP {status}",
                kind=VerifierErrorKind.PROTOCOL_VIOLATION,
                retryable=False,
                metadata={"status_code": status},
            ) from exc
        except Exception as exc:
            raise VerifierObservationError(
                "qualification provider observation transport failed",
                kind=VerifierErrorKind.PROVIDER_UNAVAILABLE,
                retryable=True,
                metadata={"error_type": type(exc).__name__},
            ) from exc

        if status != 200 or not isinstance(body, dict) or "value" not in body:
            raise VerifierObservationError(
                "qualification provider returned malformed observation",
                kind=VerifierErrorKind.MALFORMED_OBSERVATION,
                retryable=False,
                metadata={"status_code": status},
            )
        if headers.get("X-Effect-Consistency") == "pending":
            raise VerifierObservationError(
                "qualification provider state is not yet authoritative",
                kind=VerifierErrorKind.STALE_OR_INCONSISTENT,
                retryable=True,
                metadata={"external_version": headers.get("ETag")},
            )
        return Observation(
            verifier=self.name,
            resource=intent.resource,
            state={"value": str(body["value"]), "version": body.get("version")},
            external_version=headers.get("ETag"),
            metadata={"consistency": headers.get("X-Effect-Consistency", "unknown")},
        )
