"""Narrow GitHub REST adapter used for qualification.

The adapter supports issue-label add/remove operations and uses explicit provider-error classes so
transport ambiguity is not conflated with definitive rejection.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
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


@dataclass(frozen=True)
class GitHubConfig:
    token: str
    api_base: str = "https://api.github.com"
    user_agent: str = "effect-fabric/0.2.12"


class _GitHubHTTP:
    def __init__(self, config: GitHubConfig):
        self.config = config

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> tuple[int, Any, dict[str, str]]:
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            self.config.api_base.rstrip("/") + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.config.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": self.config.user_agent,
                **({"Content-Type": "application/json"} if data else {}),
            },
        )
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None, dict(response.headers)

    async def request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> tuple[int, Any, dict[str, str]]:
        return await asyncio.to_thread(self._request, method, path, payload)


def _http_failure(exc: urllib.error.HTTPError) -> ProviderExecutionError:
    status = int(exc.code)
    headers = dict(exc.headers or {})
    metadata = {
        "status_code": status,
        "retry_after": headers.get("Retry-After"),
        "rate_limit_remaining": headers.get("X-RateLimit-Remaining"),
    }
    if status == 401:
        return ProviderExecutionError(
            "GitHub authentication failed",
            kind=ProviderErrorKind.AUTHENTICATION,
            may_have_happened=False,
            safe_to_retry=False,
            metadata=metadata,
        )
    if status == 429 or (
        status == 403 and headers.get("X-RateLimit-Remaining") == "0"
    ):
        return ProviderExecutionError(
            "GitHub rate limited the request",
            kind=ProviderErrorKind.RATE_LIMITED,
            may_have_happened=False,
            safe_to_retry=True,
            metadata=metadata,
        )
    if status == 403:
        return ProviderExecutionError(
            "GitHub authorization failed",
            kind=ProviderErrorKind.AUTHORIZATION,
            may_have_happened=False,
            safe_to_retry=False,
            metadata=metadata,
        )
    if 400 <= status < 500:
        return ProviderExecutionError(
            f"GitHub definitively rejected request with HTTP {status}",
            kind=ProviderErrorKind.DEFINITIVE_REJECTION,
            may_have_happened=False,
            safe_to_retry=False,
            metadata=metadata,
        )
    return ProviderExecutionError(
        f"GitHub returned HTTP {status} after mutation request",
        kind=ProviderErrorKind.PROVIDER_UNAVAILABLE,
        may_have_happened=True,
        safe_to_retry=False,
        metadata=metadata,
    )


def _observation_http_failure(exc: urllib.error.HTTPError) -> VerifierObservationError:
    status = int(exc.code)
    headers = dict(exc.headers or {})
    metadata = {
        "status_code": status,
        "retry_after": headers.get("Retry-After"),
        "request_id": headers.get("X-GitHub-Request-Id"),
    }
    if status == 401:
        return VerifierObservationError(
            "GitHub verifier authentication failed",
            kind=VerifierErrorKind.AUTHENTICATION,
            retryable=False,
            metadata=metadata,
        )
    if status == 403 and headers.get("X-RateLimit-Remaining") != "0":
        return VerifierObservationError(
            "GitHub verifier authorization failed",
            kind=VerifierErrorKind.AUTHORIZATION,
            retryable=False,
            metadata=metadata,
        )
    if status == 429 or (
        status == 403 and headers.get("X-RateLimit-Remaining") == "0"
    ):
        return VerifierObservationError(
            "GitHub verifier rate limited",
            kind=VerifierErrorKind.RATE_LIMITED,
            retryable=True,
            metadata=metadata,
        )
    if status >= 500:
        return VerifierObservationError(
            "GitHub verifier provider unavailable",
            kind=VerifierErrorKind.PROVIDER_UNAVAILABLE,
            retryable=True,
            metadata=metadata,
        )
    return VerifierObservationError(
        f"GitHub verifier rejected observation with HTTP {status}",
        kind=VerifierErrorKind.PROTOCOL_VIOLATION,
        retryable=False,
        metadata=metadata,
    )


class GitHubIssueLabelExecutor(EffectExecutor):
    name = "github-issue-label"

    def __init__(self, config: GitHubConfig):
        self.http = _GitHubHTTP(config)

    @staticmethod
    def _parts(intent: ActionIntent):
        repo = intent.arguments["repo"]
        issue = int(intent.arguments["issue"])
        label = intent.arguments["label"]
        return repo, issue, label

    async def prepare(
        self,
        intent: ActionIntent,
        contract: EffectContract,
    ) -> PreparedEffect:
        repo, issue, _ = self._parts(intent)
        _, body, headers = await self.http.request("GET", f"/repos/{repo}/issues/{issue}")
        return PreparedEffect(
            observed_pre_state={
                "state": body.get("state"),
                "labels": [item["name"] for item in body.get("labels", [])],
                "updated_at": body.get("updated_at"),
            },
            external_version=headers.get("ETag"),
        )

    async def _revalidate_precondition(
        self, repo: str, issue: int, prepared: PreparedEffect
    ) -> str | None:
        """Fail closed if the prepared GitHub issue version changed before mutation.

        GitHub's issue-label mutation endpoints do not provide Effect Fabric with a provider
        transaction that is atomic with our local PREPARED record. A fresh ETag check narrows the
        prepare/execute race and, critically, prevents knowingly executing against stale state.
        It does not claim to eliminate the final network TOCTOU window.
        """
        expected = prepared.external_version
        if expected is None:
            return None
        try:
            status, body, headers = await self.http.request(
                "GET", f"/repos/{repo}/issues/{issue}"
            )
        except urllib.error.HTTPError as exc:
            mapped = _http_failure(exc)
            if mapped.may_have_happened:
                raise ProviderExecutionError(
                    "GitHub precondition revalidation failed before mutation",
                    kind=ProviderErrorKind.RETRYABLE_PRE_EFFECT,
                    may_have_happened=False,
                    safe_to_retry=True,
                    metadata=mapped.metadata,
                ) from exc
            raise mapped from exc
        except (TimeoutError, ConnectionError, urllib.error.URLError) as exc:
            raise ProviderExecutionError(
                "GitHub precondition revalidation transport failed before mutation",
                kind=ProviderErrorKind.RETRYABLE_PRE_EFFECT,
                may_have_happened=False,
                safe_to_retry=True,
                metadata={"error_type": type(exc).__name__},
            ) from exc

        observed = headers.get("ETag")
        if status != 200 or not isinstance(body, dict):
            raise ProviderExecutionError(
                "GitHub precondition revalidation returned an invalid response",
                kind=ProviderErrorKind.PROTOCOL_VIOLATION,
                may_have_happened=False,
                safe_to_retry=False,
                metadata={"status_code": status},
            )
        if observed != expected:
            raise ProviderExecutionError(
                "GitHub issue changed after prepare; refusing stale mutation",
                kind=ProviderErrorKind.DEFINITIVE_REJECTION,
                may_have_happened=False,
                safe_to_retry=False,
                metadata={
                    "reason": "prepared_external_version_changed",
                    "expected_etag": expected,
                    "observed_etag": observed,
                },
            )
        return observed

    async def execute(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ProviderReceipt:
        del attempt
        repo, issue, label = self._parts(intent)
        revalidated_version = await self._revalidate_precondition(repo, issue, prepared)
        try:
            if intent.operation == "github.issue.add_label":
                status, body, _ = await self.http.request(
                    "POST",
                    f"/repos/{repo}/issues/{issue}/labels",
                    {"labels": [label]},
                )
            elif intent.operation == "github.issue.remove_label":
                escaped = urllib.parse.quote(label, safe="")
                status, body, _ = await self.http.request(
                    "DELETE",
                    f"/repos/{repo}/issues/{issue}/labels/{escaped}",
                )
            else:
                raise ValueError(f"unsupported operation: {intent.operation}")
        except urllib.error.HTTPError as exc:
            raise _http_failure(exc) from exc
        except (TimeoutError, ConnectionError, urllib.error.URLError) as exc:
            raise AmbiguousEffectError(
                "GitHub mutation response was lost or transport failed",
                metadata={"error_type": type(exc).__name__},
            ) from exc

        if status != 200:
            raise ProviderExecutionError(
                f"unexpected successful GitHub status {status}",
                kind=ProviderErrorKind.PROTOCOL_VIOLATION,
                may_have_happened=True,
                safe_to_retry=False,
                metadata={"status_code": status},
            )

        return ProviderReceipt(
            provider="github",
            operation=intent.operation,
            external_id=f"{repo}#{issue}:{label}",
            status_code=status,
            idempotency_key=f"{repo}#{issue}:{label}:{intent.operation}",
            response_digest=digest_document(body),
            metadata={
                "response_type": type(body).__name__,
                "prepared_external_version": prepared.external_version,
                "precondition_revalidated": revalidated_version is not None,
            },
        )

    async def reconcile(
        self,
        intent: ActionIntent,
        prepared: PreparedEffect,
        attempt: ExecutionAttempt,
    ) -> ReconciliationStatus:
        del prepared, attempt
        repo, issue, label = self._parts(intent)
        try:
            _, body, _ = await self.http.request("GET", f"/repos/{repo}/issues/{issue}")
        except Exception:
            return ReconciliationStatus.UNKNOWN
        labels = {item["name"] for item in body.get("labels", [])}
        if intent.operation == "github.issue.add_label":
            return (
                ReconciliationStatus.HAPPENED
                if label in labels
                else ReconciliationStatus.NOT_HAPPENED
            )
        if intent.operation == "github.issue.remove_label":
            return (
                ReconciliationStatus.HAPPENED
                if label not in labels
                else ReconciliationStatus.NOT_HAPPENED
            )
        return ReconciliationStatus.UNKNOWN


class GitHubIssueVerifier(EffectVerifier):
    name = "github-issue-verifier"

    def __init__(self, config: GitHubConfig):
        # Production deployments should use separate read-only credentials here.
        self.http = _GitHubHTTP(config)

    async def observe(self, intent: ActionIntent, contract: EffectContract) -> Observation:
        del contract
        repo = intent.arguments["repo"]
        issue = int(intent.arguments["issue"])
        try:
            status, body, headers = await self.http.request(
                "GET", f"/repos/{repo}/issues/{issue}"
            )
        except urllib.error.HTTPError as exc:
            raise _observation_http_failure(exc) from exc
        except (TimeoutError, ConnectionError, urllib.error.URLError) as exc:
            raise VerifierObservationError(
                "GitHub verifier transport unavailable",
                kind=VerifierErrorKind.PROVIDER_UNAVAILABLE,
                retryable=True,
                metadata={"error_type": type(exc).__name__},
            ) from exc
        if status != 200 or not isinstance(body, dict):
            raise VerifierObservationError(
                "GitHub verifier returned malformed observation",
                kind=VerifierErrorKind.MALFORMED_OBSERVATION,
                retryable=False,
                metadata={"status_code": status},
            )
        return Observation(
            verifier=self.name,
            resource=intent.resource,
            state={
                "state": body.get("state"),
                "labels": [item["name"] for item in body.get("labels", [])],
                "updated_at": body.get("updated_at"),
            },
            external_version=headers.get("ETag"),
            metadata={"request_id": headers.get("X-GitHub-Request-Id")},
        )
