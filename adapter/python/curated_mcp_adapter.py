"""Minimal B-admission -> A-EffectGateway curated MCP catalog adapter."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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
    if data.get("format") != ADAPTER_FORMAT:
        raise AdapterError(f"unsupported snapshot format: {data.get('format')!r}")
    source = data.get("source") or {}
    if source.get("package") != "@function-hooks/capabilities":
        raise AdapterError("snapshot source.package must be @function-hooks/capabilities")
    version = str(source.get("version") or "")
    if not version.startswith("0.11."):
        raise AdapterError(f"refuse non-0.11.x capabilities snapshot: {version!r}")
    if not isinstance(data.get("records"), list):
        raise AdapterError("snapshot.records must be a list")
    return data


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
    return RegistrationPin(
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
    )


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
            key=f"{pin.capability_id}",
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

    def register_from_snapshot(self, path: str | Path) -> list[str]:
        data = load_admitted_registry(path)
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
        return pin

    async def invoke_capability(
        self,
        *,
        subject: str,
        capability_id: str,
        arguments: dict[str, Any] | None = None,
        trace_id: str | None = None,
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
        return await self.gateway.call_tool(
            subject=subject,
            server=pin.server,
            tool=pin.tool,
            arguments=args,
            trace_id=trace_id,
            approval_token=approval_token,
        )


CATALOG_TOOL_SEARCH = "search_capabilities"
CATALOG_TOOL_INVOKE = "invoke_capability"
