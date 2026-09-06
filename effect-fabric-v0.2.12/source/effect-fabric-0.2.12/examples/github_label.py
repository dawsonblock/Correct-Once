"""Skeleton live GitHub qualification example.

Requires a disposable test repository/issue and a token. Do not point early qualification runs at
production repositories.
"""

import os

from effect_fabric.adapters.github import GitHubConfig, GitHubIssueLabelExecutor, GitHubIssueVerifier

config = GitHubConfig(token=os.environ["GITHUB_TOKEN"])
executor = GitHubIssueLabelExecutor(config)
verifier = GitHubIssueVerifier(config)
print(executor.name, verifier.name)
