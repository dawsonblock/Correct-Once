import pytest

from effect_fabric.gateway import EffectGateway
from effect_fabric.gateway_api import create_gateway_app


class EmptyTransport:
    async def describe_tool(self, server, tool):
        raise KeyError((server, tool))

    async def list_tools(self, server):
        return []

    async def call_tool(self, server, tool, arguments):
        raise AssertionError("must not be called")


def test_gateway_api_is_fail_closed_without_token():
    pytest.importorskip("fastapi")
    gateway = EffectGateway(transport=EmptyTransport())
    with pytest.raises(RuntimeError, match="requires"):
        create_gateway_app(gateway, api_token=None)
