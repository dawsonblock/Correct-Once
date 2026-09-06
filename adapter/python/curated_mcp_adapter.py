"""Minimal B-admission -> A-EffectGateway curated MCP catalog adapter."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from effect_fabric.canonical import digest_document
from effect_fabric.effect_registry import McpToolIdentity, MutationClass
from effect_fabric.gateway import EffectDefinitionFactory, EffectGateway
from effect_fabric.gateway_policy import StaticGatewayPolicy
from effect_fabric.models import (
    EffectContract,
    IdempotencyContract,
    ReversibilityClass,
    ReversibilitySpec,
)
from effect_fabric.provider_profiles import (
    IdempotencyMode,
    OutcomeResolutionMode,
    ProbeMissMeaning,
    ProviderEffectProfile,
)

from .call_time_policy import CallTimeAllowlistPolicy, SubjectAllowlist
from .side_effect_map import map_side_effect

ADAPTER_FORMAT = "adapter/admitted-registry/v1"
RUNTIME_REGISTRY_FORMAT = "function-hooks.runtime-capability-registry.v0.12"


class AdapterError(RuntimeError):
    pass


class AdapterDenied(AdapterError):
    pass


@dataclass(frozen=True)
class RegistrationPin:
    capability_id: str
    app: str
    capability: str
    side_effect: str
    catalog_tag: str
    server: str
    tool: str
    input_schema: dict[str, Any]
    schema_hash_b: str
    descriptor_hash: str
    candidate_hash: str
    admission_id: str
    policy_version: str
    operation: str
    mutation_class: MutationClass
    execution_class: str | None = None
    executor: str | None = None
    schema_class_digest: str | None = None
    requires_lightweight_auth: bool | None = None
    trusted_read: bool | None = None


@dataclass(frozen=True)
class TrustedWriteIdentity:
    idempotency_key: str
    action_id: str


def _require(obj: dict[str, Any], key: str) -> Any:
    if key not in obj:
        raise AdapterError(f"missing required field: {key}")
    return obj[key]


def _unresolved_profile(tool_pattern: str) -> ProviderEffectProfile:
    return ProviderEffectProfile(
        profile_id=f"adapter-unresolved:{tool_pattern}",
        tool_pattern=tool_pattern,
        idempotency_mode=IdempotencyMode.NONE,
        resolution_mode=OutcomeResolutionMode.NONE,
        miss_meaning=ProbeMissMeaning.INCONCLUSIVE,
    )


def load_admitted_registry(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("format") == ADAPTER_FORMAT:
        source = data.get("source") or {}
        if source.get("package") != "@function-hooks/capabilities":
            raise AdapterError("snapshot source.package must be @function-hooks/capabilities")
        version = str(source.get("version") or "")
        if not version.startswith("0.11."):
            raise AdapterError(f"refuse non-0.11.x capabilities snapshot: {version!r}")
        if not isinstance(data.get("records"), list):
            raise AdapterError("snapshot.records must be a list")
        return data

    if data.get("format") == RUNTIME_REGISTRY_FORMAT:
        records = data.get("records")
        if not isinstance(records, list):
            raise AdapterError("runtime snapshot.records must be a list")
        return {
            "format": ADAPTER_FORMAT,
            "source": {
                "package": "@function-hooks/capabilities",
                "version": "0.11.0",
            },
            "records": [_normalize_runtime_record(record) for record in records],
        }

    raise AdapterError(f"unsupported snapshot format: {data.get('format')!r}")


def _normalize_runtime_record(record: dict[str, Any]) -> dict[str, Any]:
    runtime_capability = _require(record, "capability")
    if not isinstance(runtime_capability, dict):
        raise AdapterError("runtime record.capability must be an object")
    admitted = _require(runtime_capability, "capability")
    if not isinstance(admitted, dict):
        raise AdapterError("runtime capability.capability must be an object")
    normalized: dict[str, Any] = {
        "state": record.get("state"),
        "capability": admitted,
    }
    execution = runtime_capability.get("execution")
    if execution is not None:
        if not isinstance(execution, dict):
            raise AdapterError("runtime capability.execution must be an object")
        normalized["execution"] = dict(execution)
    for field in ("stateVersion", "updatedAt", "reason"):
        if field in record:
            normalized[field] = record[field]
    return normalized


def _parse_execution_pin(record: dict[str, Any]) -> dict[str, Any]:
    execution = record.get("execution")
    if execution is None:
        return {}
    if not isinstance(execution, dict):
        raise AdapterError("record.execution must be an object when present")
    execution_class = str(_require(execution, "executionClass"))
    executor = str(_require(execution, "executor"))
    schema_class_digest = str(_require(execution, "schemaClassDigest"))
    requires_lightweight_auth = execution.get("requiresLightweightAuth")
    trusted_read = execution.get("trustedRead")
    if not execution_class:
        raise AdapterError("execution.executionClass must be non-empty")
    if not executor:
        raise AdapterError("execution.executor must be non-empty")
    if not schema_class_digest:
        raise AdapterError("execution.schemaClassDigest must be non-empty")
    if not isinstance(requires_lightweight_auth, bool):
        raise AdapterError("execution.requiresLightweightAuth must be a boolean")
    if not isinstance(trusted_read, bool):
        raise AdapterError("execution.trustedRead must be a boolean")
    return {
        "execution_class": execution_class,
        "executor": executor,
        "schema_class_digest": schema_class_digest,
        "requires_lightweight_auth": requires_lightweight_auth,
        "trusted_read": trusted_read,
    }


def _validate_execution_pin(pin: RegistrationPin) -> None:
    if pin.execution_class is None:
        return
    if pin.mutation_class is MutationClass.READ_ONLY:
        if pin.execution_class != "read" or pin.executor != "fast":
            raise AdapterDenied(
                "read capability runtime pin drifted: expected executionClass=read executor=fast"
            )
        return
    if pin.execution_class != "critical" or pin.executor != "effect":
        raise AdapterDenied(
            "mutating capability runtime pin drifted: expected executionClass=critical executor=effect"
        )


def _fallback_effect_idempotency_key(
    pin: RegistrationPin, arguments: dict[str, Any]
) -> str:
    return digest_document(
        {
            "capabilityId": pin.capability_id,
            "arguments": arguments,
        }
    )


def _optional_non_empty(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        raise AdapterError(f"{field} must be a non-empty string when provided")
    return normalized


def _trusted_write_identity(
    *,
    subject: str,
    capability_id: str,
    arguments: dict[str, Any],
    idempotency_key: str | None,
    action_id: str | None,
) -> TrustedWriteIdentity:
    request_action_digest = digest_document({"input": arguments})
    caller_key = _optional_non_empty(idempotency_key, "idempotency_key")
    if caller_key is None:
        caller_key = request_action_digest
    trusted_idempotency_key = digest_document(
        {
            "subject": subject,
            "capabilityId": capability_id,
            "idempotencyKey": caller_key,
        }
    )
    trusted_action_id = _optional_non_empty(action_id, "action_id")
    if trusted_action_id is None:
        trusted_action_id = digest_document(
            {
                "subject": subject,
                "capabilityId": capability_id,
                "idempotencyKey": caller_key,
                "actionDigest": request_action_digest,
            }
        )
    return TrustedWriteIdentity(
        idempotency_key=trusted_idempotency_key,
        action_id=trusted_action_id,
    )


def parse_active_mcp_pin(record: dict[str, Any]) -> RegistrationPin:
    state = record.get("state")
    if state != "active":
        raise AdapterDenied(f"capability not active: state={state!r}")
    cap = _require(record, "capability")
    if not isinstance(cap, dict):
        raise AdapterError("record.capability must be an object")
    if cap.get("lifecycle") != "admitted":
        raise AdapterDenied("only admitted capabilities may register")
    admission = _require(cap, "admission")
    if admission.get("kind") != "function-hooks.capability-admission.v1":
        raise AdapterDenied("invalid admission evidence kind")
    if admission.get("candidateHash") != cap.get("candidateHash"):
        raise AdapterDenied("admission.candidateHash mismatch")
    if admission.get("descriptorHash") != cap.get("descriptorHash"):
        raise AdapterDenied("admission.descriptorHash mismatch")

    provenance = _require(cap, "provenance")
    if not isinstance(provenance, dict):
        raise AdapterError("provenance must be an object")
    version = provenance.get("version")
    if version == "latest":
        raise AdapterDenied("refuse floating provenance.version=latest")

    # Gate 1: require provenance.schemaDigest == schemaHash; refuse if missing/disagree.
    schema_hash = _require(cap, "schemaHash")
    if not isinstance(schema_hash, str) or not schema_hash:
        raise AdapterDenied("missing schemaHash")
    schema_digest = provenance.get("schemaDigest")
    if not isinstance(schema_digest, str) or not schema_digest:
        raise AdapterDenied("missing provenance.schemaDigest")
    if schema_digest != schema_hash:
        raise AdapterDenied(
            f"provenance.schemaDigest != schemaHash ({schema_digest!r} != {schema_hash!r})"
        )

    impl = _require(cap, "implementation")
    if impl.get("kind") != "mcp":
        raise AdapterDenied(
            f"curated MCP catalog only admits kind=mcp, got {impl.get('kind')!r}"
        )
    server = str(_require(impl, "server"))
    tool = str(_require(impl, "tool"))
    if not server or not tool:
        raise AdapterError("mcp implementation requires non-empty server/tool")

    side_effect = str(_require(cap, "sideEffect"))
    mapped = map_side_effect(side_effect)
    input_schema = _require(cap, "inputSchema")
    if not isinstance(input_schema, dict):
        raise AdapterError("inputSchema must be an object for A McpToolIdentity")

    app = str(_require(cap, "app"))
    capability = str(_require(cap, "capability"))
    cap_id = str(_require(cap, "id"))
    pin = RegistrationPin(
        capability_id=cap_id,
        app=app,
        capability=capability,
        side_effect=side_effect,
        catalog_tag=mapped.catalog_tag,
        server=server,
        tool=tool,
        input_schema=dict(input_schema),
        schema_hash_b=str(schema_hash),
        descriptor_hash=str(_require(cap, "descriptorHash")),
        candidate_hash=str(_require(cap, "candidateHash")),
        admission_id=str(_require(admission, "admissionId")),
        policy_version=str(_require(admission, "policyVersion")),
        operation=f"{app}.{capability}",
        mutation_class=MutationClass(mapped.mutation_class),
        **_parse_execution_pin(record),
    )
    _validate_execution_pin(pin)
    return pin


def build_effect_factory(pin: RegistrationPin) -> EffectDefinitionFactory:
    # Gate 1: pin A McpToolIdentity from B inputSchema (schema_digest derived by A).
    mcp = McpToolIdentity(
        server=pin.server,
        tool=pin.tool,
        input_schema=pin.input_schema,
    )
    tool_pattern = f"{pin.server}.{pin.tool}"
    profile = _unresolved_profile(tool_pattern)
    quals = (
        f"b.admission:{pin.admission_id}",
        f"b.candidate:{pin.candidate_hash}",
        f"b.descriptor:{pin.descriptor_hash}",
        f"b.schemaHash:{pin.schema_hash_b}",
        f"b.sideEffect:{pin.side_effect}",
    )
    if pin.mutation_class is MutationClass.READ_ONLY:
        return EffectDefinitionFactory(
            operation=pin.operation,
            mcp=mcp,
            mutation_class=MutationClass.READ_ONLY,
            executor=f"unused-read:{pin.server}:{pin.tool}",
            provider_profile=profile,
            factory_version=f"adapter:{pin.admission_id}",
            qualification_ids=quals,
        )

    mapped = map_side_effect(pin.side_effect)
    assert mapped.reversibility is not None
    rev = ReversibilityClass(mapped.reversibility)

    def resource_factory(a: dict[str, Any]) -> str:
        return f"cap://{pin.capability_id}"

    def contract_factory(a: dict[str, Any]) -> EffectContract:
        return EffectContract(
            resource=f"cap://{pin.capability_id}",
            verifier="adapter-no-verifier",
        )

    def idempotency_factory(a: dict[str, Any]) -> IdempotencyContract:
        return IdempotencyContract(
            mechanism="natural_resource",
            key=_fallback_effect_idempotency_key(pin, a),
            retry_after_not_happened=False,
            retry_after_unknown=False,
        )

    def reversibility_factory(a: dict[str, Any]) -> ReversibilitySpec:
        return ReversibilitySpec(classification=rev)

    return EffectDefinitionFactory(
        operation=pin.operation,
        mcp=mcp,
        mutation_class=pin.mutation_class,
        executor=f"mcp:{pin.server}:{pin.tool}",
        provider_profile=profile,
        factory_version=f"adapter:{pin.admission_id}",
        resource_factory=resource_factory,
        contract_factory=contract_factory,
        idempotency_factory=idempotency_factory,
        reversibility_factory=reversibility_factory,
        qualification_ids=quals,
    )


class CuratedMcpAdapter:
    """Wires admitted B snapshot -> A EffectGateway; search + invoke-by-id."""

    def __init__(
        self,
        gateway: EffectGateway,
        *,
        subjects: dict[str, SubjectAllowlist] | None = None,
        allowed_operations: set[str] | None = None,
    ) -> None:
        self.gateway = gateway
        self._pins_by_id: dict[str, RegistrationPin] = {}
        self._pins_by_mcp: dict[tuple[str, str], RegistrationPin] = {}
        self._catalog: dict[str, dict[str, Any]] = {}
        self._subjects = subjects or {}
        self._pending_allowed_ops = allowed_operations
        self._snapshot_path: Path | None = None

    def register_from_snapshot(self, path: str | Path) -> list[str]:
        data = load_admitted_registry(path)
        self._snapshot_path = Path(path)
        registered: list[str] = []
        ops: set[str] = set(self._pending_allowed_ops or ())
        for record in data["records"]:
            if record.get("state") != "active":
                continue
            pin = parse_active_mcp_pin(record)
            key = (pin.server, pin.tool)
            if pin.capability_id in self._pins_by_id:
                existing = self._pins_by_id[pin.capability_id]
                if existing.candidate_hash != pin.candidate_hash:
                    raise AdapterError(
                        f"duplicate capability id with different candidateHash: {pin.capability_id}"
                    )
                continue
            if key in self._pins_by_mcp and self._pins_by_mcp[key].capability_id != pin.capability_id:
                raise AdapterError(
                    f"MCP {pin.server}/{pin.tool} already pinned to {self._pins_by_mcp[key].capability_id}"
                )
            factory = build_effect_factory(pin)
            self.gateway.register_tool(factory)
            self._pins_by_id[pin.capability_id] = pin
            self._pins_by_mcp[key] = pin
            cap = record["capability"]
            entry = {
                "id": pin.capability_id,
                "app": pin.app,
                "capability": pin.capability,
                "description": cap.get("description", ""),
                "inputSchema": pin.input_schema,
                "sideEffect": pin.side_effect,
                "catalogTag": pin.catalog_tag,
                "sensitivity": cap.get("sensitivity"),
                "risk": cap.get("risk"),
                "schemaHash": pin.schema_hash_b,
            }
            if "outputSchema" in cap:
                entry["outputSchema"] = cap["outputSchema"]
            self._catalog[pin.capability_id] = entry
            ops.add(pin.operation)
            registered.append(pin.capability_id)

        inner = StaticGatewayPolicy(allowed_operations=ops)
        self.gateway.policy = CallTimeAllowlistPolicy(
            inner=inner,
            subjects=self._subjects,
            pins_by_mcp=self._pins_by_mcp,
        )
        return registered

    def search_capabilities(
        self,
        *,
        query: str | None = None,
        catalog_tag: str | None = None,
        app: str | None = None,
    ) -> list[dict[str, Any]]:
        q = (query or "").strip().lower()
        out: list[dict[str, Any]] = []
        for entry in sorted(self._catalog.values(), key=lambda e: e["id"]):
            if catalog_tag and entry["catalogTag"] != catalog_tag:
                continue
            if app and entry["app"] != app:
                continue
            if q:
                blob = f"{entry['id']} {entry['description']} {entry['capability']}".lower()
                if q not in blob:
                    continue
            out.append(dict(entry))
        return out

    def _recheck_pin(self, capability_id: str) -> RegistrationPin:
        pin = self._pins_by_id.get(capability_id)
        if pin is None:
            raise AdapterDenied(f"unknown capability id (fail closed): {capability_id}")
        entry = self._catalog.get(capability_id)
        if entry is None or entry.get("schemaHash") != pin.schema_hash_b:
            raise AdapterDenied("catalog pin drift detected")
        if self._snapshot_path is not None:
            try:
                live_snapshot = load_admitted_registry(self._snapshot_path)
            except Exception as exc:  # pragma: no cover - fail closed
                raise AdapterDenied(
                    f"failed to reload authoritative snapshot: {self._snapshot_path}"
                ) from exc
            live_record = None
            for record in live_snapshot["records"]:
                cap = record.get("capability")
                if isinstance(cap, dict) and cap.get("id") == capability_id:
                    live_record = record
                    break
            if live_record is None:
                raise AdapterDenied(
                    f"authoritative snapshot no longer contains capability id: {capability_id}"
                )
            live_pin = parse_active_mcp_pin(live_record)
            if live_pin != pin:
                raise AdapterDenied("authoritative pin drift detected")
        return pin

    async def invoke_capability(
        self,
        *,
        subject: str,
        capability_id: str,
        arguments: dict[str, Any] | None = None,
        trace_id: str | None = None,
        idempotency_key: str | None = None,
        action_id: str | None = None,
        approval_token: str | None = None,
    ) -> Any:
        pin = self._recheck_pin(capability_id)
        if subject not in self._subjects:
            raise AdapterDenied(f"unknown subject denied: {subject}")
        allow = self._subjects[subject]
        mapped = map_side_effect(pin.side_effect)
        if mapped.catalog_tag not in allow.allowed_classes:
            raise AdapterDenied(
                f"class {mapped.catalog_tag!r} not allow-listed for {subject}"
            )
        if mapped.catalog_tag == "destructive" and not allow.allow_destructive:
            raise AdapterDenied(
                "destructive requires allow_destructive=True (default OFF)"
            )
        if (
            allow.allowed_capability_ids is not None
            and capability_id not in allow.allowed_capability_ids
        ):
            raise AdapterDenied(f"capability id not in subject scope: {capability_id}")

        # Gate 3: pass clean args only — policy looks up pin by server+tool.
        args = dict(arguments or {})
        trusted_write = None
        if pin.mutation_class is not MutationClass.READ_ONLY:
            trusted_write = _trusted_write_identity(
                subject=subject,
                capability_id=capability_id,
                arguments=args,
                idempotency_key=idempotency_key,
                action_id=action_id,
            )
        return await self.gateway.call_tool(
            subject=subject,
            server=pin.server,
            tool=pin.tool,
            arguments=args,
            trace_id=trace_id if trace_id is not None else (
                trusted_write.action_id if trusted_write is not None else None
            ),
            idempotency_key=(
                trusted_write.idempotency_key if trusted_write is not None else None
            ),
            action_id=trusted_write.action_id if trusted_write is not None else None,
            approval_token=approval_token,
        )


CATALOG_TOOL_SEARCH = "search_capabilities"
CATALOG_TOOL_INVOKE = "invoke_capability"
