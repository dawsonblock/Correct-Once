"""Permanent live MCP + Effect Gateway service for Correct-Once.

This package is intentionally host-path only. It is BLOCK RELEASE until
packaging, deployment, and broader qualification residuals close.
"""

from .app import create_app
from .config import GatewayServiceConfig

__all__ = ["GatewayServiceConfig", "create_app"]
