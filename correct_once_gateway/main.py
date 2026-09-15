from __future__ import annotations

import uvicorn

from .app import create_app
from .config import GatewayServiceConfig


def main() -> None:
    config = GatewayServiceConfig.from_env()
    app = create_app(config)
    uvicorn.run(app, host=config.host, port=config.port, log_level="warning")


if __name__ == "__main__":
    main()
