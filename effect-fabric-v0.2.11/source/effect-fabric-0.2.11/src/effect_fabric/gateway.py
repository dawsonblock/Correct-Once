"""Single mutation gateway for Effect Fabric.

Agents should submit tool calls here rather than receiving direct authority to call mutating MCP
servers.  Read-only passthrough is explicit; mutations are proposed, prepared, authorized by an
independent policy object, durably started, executed, optionally reconciled, and optionally
verified.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict

from .canonical import digest_document
from .effect_registry import (
    CompensationMapping,
    McpToolIdentity,
    MutationClass,
    RegistryDecision,
)
from .engine import EffectEngine
from .errors import AuthorizationError
from .gateway_policy import (
    DenyAllMutationPolicy,
    GatewayPolicy,
    GatewayPolicyRequest,
    PolicyDecision,
)
from .integrations.mcp_gateway import (
    McpMutationAdapterConfig,
    McpMutationExecutor,
    McpToolDescriptor,
    McpTransport,
    PrepareProbe,
    ReconcileProbe,
)
from .models import (
    ActionIntent,
    EffectContract,
    ExecutionState,
    IdempotencyContract,
    ReversibilitySpec,
)
from .provider_profiles import OutcomeResolutionMode, ProviderEffectProfile


class GatewayError(RuntimeError):
    pass


class GatewayDenied(GatewayError):
    pass


class GatewayApprovalRequired(GatewayError):
    pass


class GatewayConfigurationError(GatewayError):
    pass


class GatewayMode(StrEnum):
    PASSTHROUGH_READ = "passthrough_read"
    GOVERNED_EFFECT = "governed_effect"


ResourceFactory = Callable[[dict[str, Any]], str]
ContractFactory = Callable[[dict[str, Any]], EffectContract]
IdempotencyFactory = Callable[[dict[str, Any]], IdempotencyContract]
ReversibilityFactory = Callable[[dict[str, Any]], ReversibilitySpec]


class BoundEffectDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, arbitrary_types_allowed=True)

    operation: str
    resource: str
    executor: str
    contract: EffectContract
    idempotency: IdempotencyContract
    reversibility: ReversibilitySpec
    provider_profile: ProviderEffectProfile
    registration_digest: str


@dataclass(frozen=True)
class EffectDefinitionFactory:
    """Per-call effect definition factory.

    ``factory_version`` is an explicit semantic revision identifier.  The complete release source
    tree remains source-bound by qualification provenance; this identifier makes duplicate runtime
    registration deterministic without attempting unreliable Python callable introspection.
    """

    operation: str
    mcp: McpToolIdentity
    mutation_class: MutationClass
    executor: str
    provider_profile: ProviderEffectProfile
    factory_version: str
    resource_factory: ResourceFactory | None = None
    contract_factory: ContractFactory | None = None
    idempotency_factory: IdempotencyFactory | None = None
    reversibility_factory: ReversibilityFactory | None = None
    compensation: CompensationMapping | None = None
    exact_action_authorization: bool = True
    qualification_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.mutation_class is not MutationClass.READ_ONLY:
            required = {
                "resource_factory": self.resource_factory,
                "contract_factory": self.contract_factory,
                "idempotency_factory": self.idempotency_factory,
                "reversibility_factory": self.reversibility_factory,
            }
            missing = [name for name, value in required.items() if value is None]
            if missing:
                raise ValueError(f"mutating effect factory missing: {', '.join(missing)}")

    @property
    def digest(self) -> str:
        return digest_document(
            {
                "schema_version": "effect-fabric/effect-definition-factory/v1",
                "operation": self.operation,
                "mcp": self.mcp.model_dump(mode="json"),
                "mutation_class": self.mutation_class.value,
                "executor": self.executor,
                "provider_profile_digest": self.provider_profile.digest,
                "factory_version": self.factory_version,
                "compensation": (
                    self.compensation.model_dump(mode="json") if self.compensation else None
                ),
                "exact_action_authorization": self.exact_action_authorization,
                "qualification_ids": list(self.qualification_ids),
            }
        )

    def bind(self, arguments: dict[str, Any]) -> BoundEffectDefinition:
        if self.mutation_class is MutationClass.READ_ONLY:
            raise ValueError("read-only definitions are not bound as governed effects")
        assert self.resource_factory is not None
        assert self.contract_factory is not None
        assert self.idempotency_factory is not None
        assert self.reversibility_factory is not None
        resource = self.resource_factory(arguments)
        contract = self.contract_factory(arguments)
        if contract.resource != resource:
            raise GatewayConfigurationError(
                "contract_factory resource must match resource_factory result"
            )
        return BoundEffectDefinition(
            operation=self.operation,
            resource=resource,
            executor=self.executor,
            contract=contract,
            idempotency=self.idempotency_factory(arguments),
            reversibility=self.reversibility_factory(arguments),
            provider_profile=self.provider_profile,
            registration_digest=self.digest,
        )


class EffectRegistryV3:
    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], EffectDefinitionFactory] = {}

    def register(self, definition: EffectDefinitionFactory) -> None:
        key = (definition.mcp.server, definition.mcp.tool)
        current = self._definitions.get(key)
        if current is not None and current.digest != definition.digest:
            raise ValueError(f"effect factory already registered with different digest: {key}")
        self._definitions[key] = definition

    def get(self, server: str, tool: str) -> EffectDefinitionFactory | None:
        return self._definitions.get((server, tool))

    def route(self, descriptor: McpToolDescriptor) -> RegistryDecision:
        definition = self.get(descriptor.server, descriptor.name)
        if definition is None:
            return RegistryDecision.DENY_UNKNOWN_MUTATION
        if definition.mcp.schema_digest != descriptor.schema_digest:
            return RegistryDecision.DENY_SCHEMA_DRIFT
        if definition.mutation_class is MutationClass.READ_ONLY:
            return RegistryDecision.PASSTHROUGH_READ
        return RegistryDecision.GOVERNED_EFFECT

    def bind(
        self,
        descriptor: McpToolDescriptor,
        arguments: dict[str, Any],
    ) -> BoundEffectDefinition:
        decision = self.route(descriptor)
        if decision is not RegistryDecision.GOVERNED_EFFECT:
            raise GatewayDenied(f"tool is not a governed effect: {decision.value}")
        definition = self.get(descriptor.server, descriptor.name)
        assert definition is not None
        return definition.bind(arguments)


class GatewayCallResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: GatewayMode
    server: str
    tool: str
    output: Any = None
    transaction_id: str | None = None
    execution_state: str | None = None
    verification_state: str | None = None
    reconciliation_status: str | None = None
    action_digest: str | None = None


@dataclass(frozen=True)
class EffectGatewayConfig:
    worker_id: str = "effect-gateway"
    capability_ttl_seconds: int = 60
    lease_seconds: int = 30
    auto_reconcile_unknown: bool = True
    auto_verify: bool = True
    # Unknown tools are denied even if their server claims readOnlyHint.  This can be loosened for
    # a specifically trusted MCP host, but registration-by-default is safer.
    allow_unregistered_reads: bool = False


def _normalize_optional_identity(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field} must be a non-empty string when provided")
    return normalized


def _bind_trusted_idempotency(
    bound: BoundEffectDefinition,
    *,
    idempotency_key: str | None,
) -> BoundEffectDefinition:
    if idempotency_key is None:
        return bound
    return bound.model_copy(
        update={
            "idempotency": bound.idempotency.model_copy(
                update={"key": idempotency_key}
            )
        }
    )


class EffectGateway:
    def __init__(
        self,
        *,
        transport: McpTransport,
        engine: EffectEngine | None = None,
        policy: GatewayPolicy | None = None,
        registry: EffectRegistryV3 | None = None,
        config: EffectGatewayConfig | None = None,
    ) -> None:
        self.transport = transport
        self.engine = engine or EffectEngine()
        self.policy = policy or DenyAllMutationPolicy()
        self.registry = registry or EffectRegistryV3()
        self.config = config or EffectGatewayConfig()
        self._mcp_executors: dict[tuple[str, str], McpMutationExecutor] = {}

    def register_tool(
        self,
        definition: EffectDefinitionFactory,
        *,
        prepare_probe: PrepareProbe | None = None,
        reconcile_probe: ReconcileProbe | None = None,
    ) -> None:
        self.registry.register(definition)
        if definition.mutation_class is MutationClass.READ_ONLY:
            return
        if (
            definition.provider_profile.resolution_mode is not OutcomeResolutionMode.NONE
            and reconcile_probe is None
        ):
            raise GatewayConfigurationError(
                "provider profile claims outcome resolution but no reconcile_probe was supplied"
            )
        executor = McpMutationExecutor(
            self.transport,
            McpMutationAdapterConfig(
                server=definition.mcp.server,
                tool=definition.mcp.tool,
                executor_name=definition.executor,
                expected_schema_digest=definition.mcp.schema_digest,
                prepare_probe=prepare_probe,
                reconcile_probe=reconcile_probe,
            ),
        )
        existing = self.engine.executors.get(executor.name)
        if existing is not None and existing is not executor:
            raise GatewayConfigurationError(
                f"executor name already registered: {executor.name}; use one name per MCP mutation"
            )
        self.engine.register_executor(executor)
        self._mcp_executors[(definition.mcp.server, definition.mcp.tool)] = executor

    async def list_tools(self, server: str) -> list[McpToolDescriptor]:
        """Return only tools that this gateway can route safely."""
        advertised = await self.transport.list_tools(server)
        visible: list[McpToolDescriptor] = []
        for descriptor in advertised:
            decision = self.registry.route(descriptor)
            if decision in {
                RegistryDecision.PASSTHROUGH_READ,
                RegistryDecision.GOVERNED_EFFECT,
            }:
                visible.append(descriptor)
            elif (
                self.config.allow_unregistered_reads
                and descriptor.declared_read_only
                and self.registry.get(descriptor.server, descriptor.name) is None
            ):
                visible.append(descriptor)
        return visible

    async def call_tool(
        self,
        *,
        subject: str,
        server: str,
        tool: str,
        arguments: dict[str, Any],
        trace_id: str | None = None,
        idempotency_key: str | None = None,
        action_id: str | None = None,
        approval_token: str | None = None,
    ) -> GatewayCallResult:
        definition = self.registry.get(server, tool)
        if definition is None and not self.config.allow_unregistered_reads:
            # Fail closed before even asking an unknown tool for metadata.  This makes the
            # registered gateway surface authoritative instead of relying on remote hints.
            raise GatewayDenied(f"unregistered tool denied: {server}/{tool}")

        descriptor = await self.transport.describe_tool(server, tool)
        if definition is None:
            if descriptor.declared_read_only:
                result = await self.transport.call_tool(server, tool, arguments)
                return GatewayCallResult(
                    mode=GatewayMode.PASSTHROUGH_READ,
                    server=server,
                    tool=tool,
                    output=result.content,
                )
            raise GatewayDenied(f"unregistered tool denied: {server}/{tool}")

        decision = self.registry.route(descriptor)
        if decision is RegistryDecision.DENY_SCHEMA_DRIFT:
            raise GatewayDenied(f"MCP schema drift denied: {server}/{tool}")
        if decision is RegistryDecision.DENY_UNKNOWN_MUTATION:
            raise GatewayDenied(f"unknown MCP mutation denied: {server}/{tool}")
        if decision is RegistryDecision.PASSTHROUGH_READ:
            result = await self.transport.call_tool(server, tool, arguments)
            return GatewayCallResult(
                mode=GatewayMode.PASSTHROUGH_READ,
                server=server,
                tool=tool,
                output=result.content,
            )

        trusted_idempotency_key = _normalize_optional_identity(
            idempotency_key, "idempotency_key"
        )
        trusted_action_id = _normalize_optional_identity(action_id, "action_id")
        bound = _bind_trusted_idempotency(
            definition.bind(arguments),
            idempotency_key=trusted_idempotency_key,
        )
        intent_kwargs: dict[str, Any] = {
            "subject": subject,
            "operation": bound.operation,
            "resource": bound.resource,
            "arguments": dict(arguments),
            "trace_id": trace_id if trace_id is not None else trusted_action_id,
        }
        if trusted_action_id is not None:
            intent_kwargs["intent_id"] = trusted_action_id
        intent = ActionIntent(**intent_kwargs)
        tx = await self.engine.propose(
            intent=intent,
            contract=bound.contract,
            idempotency=bound.idempotency,
            reversibility=bound.reversibility,
        )
        if tx.execution_state is ExecutionState.PLANNED:
            tx = await self.engine.prepare(tx.transaction_id, bound.executor)

        if tx.execution_state in {
            ExecutionState.PREPARED,
            ExecutionState.AUTHORIZED,
        }:
            grant = await self.policy.authorize(
                GatewayPolicyRequest(
                    transaction=tx,
                    server=server,
                    tool=tool,
                    registration_digest=bound.registration_digest,
                    approval_token=approval_token,
                )
            )
            if grant.decision is PolicyDecision.REQUIRE_APPROVAL:
                raise GatewayApprovalRequired(grant.reason or "external approval required")
            if grant.decision is not PolicyDecision.ALLOW:
                raise GatewayDenied(grant.reason or "policy denied effect")

            try:
                capability = await self.engine.authorize(
                    tx.transaction_id,
                    bound.executor,
                    ttl_seconds=self.config.capability_ttl_seconds,
                    policy_version=grant.policy_version,
                    approval_digest=grant.approval_digest,
                )
            except AuthorizationError:
                raise

            tx = await self.engine.execute(
                tx.transaction_id,
                capability,
                worker_id=self.config.worker_id,
                lease_seconds=self.config.lease_seconds,
            )
        reconciliation_status = None
        if tx.execution_state is ExecutionState.UNKNOWN and self.config.auto_reconcile_unknown:
            status = await self.engine.reconcile(tx.transaction_id)
            reconciliation_status = status.value
            tx = await self.engine.store.get_transaction(tx.transaction_id)

        if (
            self.config.auto_verify
            and tx.execution_state
            in {
                ExecutionState.RECEIPT_RECORDED,
                ExecutionState.RECONCILED,
                ExecutionState.EXECUTION_FAILED,
            }
            and tx.contract.verifier in self.engine.verifiers
        ):
            await self.engine.verify(tx.transaction_id)
            tx = await self.engine.store.get_transaction(tx.transaction_id)

        executor = self._mcp_executors[(server, tool)]
        output: Any = None
        volatile = executor.pop_result(tx.latest_attempt_id)
        if volatile is not None:
            output = volatile.content

        return GatewayCallResult(
            mode=GatewayMode.GOVERNED_EFFECT,
            server=server,
            tool=tool,
            output=output,
            transaction_id=tx.transaction_id,
            execution_state=tx.execution_state.value,
            verification_state=tx.verification_state.value,
            reconciliation_status=reconciliation_status,
            action_digest=tx.action_digest,
        )
