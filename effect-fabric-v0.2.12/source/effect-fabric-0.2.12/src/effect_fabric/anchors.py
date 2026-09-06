from __future__ import annotations

import base64
import json
import os
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from pydantic import BaseModel, ConfigDict, Field

from .canonical import canonical_json, digest_document
from .ledger import HashChainLedger


class LedgerAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    anchor_id: str = Field(default_factory=lambda: str(uuid4()))
    sequence: int = Field(ge=1)
    ledger_root: str
    previous_anchor_hash: str | None = None
    anchored_at: datetime
    environment_id: str = "development"
    release_id: str = "0.2.12"
    key_id: str
    signature: str
    anchor_hash: str


class AnchorStore(Protocol):
    def append(self, anchor: LedgerAnchor) -> None: ...

    def load(self) -> list[LedgerAnchor]: ...


class AnchorSigner:
    def __init__(
        self,
        private_key: Ed25519PrivateKey | None = None,
        key_id: str = "anchor-dev-key",
        *,
        environment_id: str = "development",
        release_id: str = "0.2.12",
    ):
        self.private = private_key or Ed25519PrivateKey.generate()
        self.public: Ed25519PublicKey = self.private.public_key()
        self.key_id = key_id
        self.environment_id = environment_id
        self.release_id = release_id

    def public_key_b64(self) -> str:
        raw = self.public.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        return base64.b64encode(raw).decode("ascii")

    @classmethod
    def from_private_bytes(
        cls,
        private_bytes: bytes,
        *,
        key_id: str,
        environment_id: str = "development",
        release_id: str = "0.2.12",
    ) -> "AnchorSigner":
        return cls(
            Ed25519PrivateKey.from_private_bytes(private_bytes),
            key_id=key_id,
            environment_id=environment_id,
            release_id=release_id,
        )

    def private_key_bytes(self) -> bytes:
        return self.private.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )

    def sign(
        self,
        *,
        sequence: int,
        ledger_root: str,
        previous_anchor_hash: str | None = None,
    ) -> LedgerAnchor:
        anchored_at = datetime.now(UTC)
        anchor_id = str(uuid4())
        body = {
            "anchor_id": anchor_id,
            "sequence": sequence,
            "ledger_root": ledger_root,
            "previous_anchor_hash": previous_anchor_hash,
            "anchored_at": anchored_at.isoformat(),
            "environment_id": self.environment_id,
            "release_id": self.release_id,
            "key_id": self.key_id,
        }
        signature = base64.b64encode(self.private.sign(canonical_json(body))).decode("ascii")
        anchor_hash = digest_document({**body, "signature": signature})
        return LedgerAnchor(
            anchor_id=anchor_id,
            sequence=sequence,
            ledger_root=ledger_root,
            previous_anchor_hash=previous_anchor_hash,
            anchored_at=anchored_at,
            environment_id=self.environment_id,
            release_id=self.release_id,
            key_id=self.key_id,
            signature=signature,
            anchor_hash=anchor_hash,
        )

    def verify(self, anchor: LedgerAnchor) -> None:
        AnchorKeyring({self.key_id: self.public}).verify(anchor)


class AnchorKeyring:
    """Verifier keyring that preserves old public keys across signing-key rotation."""

    def __init__(self, keys: dict[str, Ed25519PublicKey] | None = None):
        self._keys = dict(keys or {})

    def add(self, key_id: str, public_key: Ed25519PublicKey) -> None:
        if key_id in self._keys:
            existing = self._keys[key_id].public_bytes(
                serialization.Encoding.Raw,
                serialization.PublicFormat.Raw,
            )
            candidate = public_key.public_bytes(
                serialization.Encoding.Raw,
                serialization.PublicFormat.Raw,
            )
            if existing != candidate:
                raise ValueError(f"key_id {key_id!r} already maps to another public key")
        self._keys[key_id] = public_key

    def add_b64(self, key_id: str, value: str) -> None:
        self.add(key_id, Ed25519PublicKey.from_public_bytes(base64.b64decode(value)))

    def verify(
        self,
        anchor: LedgerAnchor,
        *,
        expected_environment_id: str | None = None,
        expected_release_id: str | None = None,
    ) -> None:
        public_key = self._keys.get(anchor.key_id)
        if public_key is None:
            raise KeyError(f"unknown anchor key_id {anchor.key_id}")
        body = {
            "anchor_id": anchor.anchor_id,
            "sequence": anchor.sequence,
            "ledger_root": anchor.ledger_root,
            "previous_anchor_hash": anchor.previous_anchor_hash,
            "anchored_at": anchor.anchored_at.isoformat(),
            "environment_id": anchor.environment_id,
            "release_id": anchor.release_id,
            "key_id": anchor.key_id,
        }
        public_key.verify(base64.b64decode(anchor.signature), canonical_json(body))
        expected_hash = digest_document({**body, "signature": anchor.signature})
        if expected_hash != anchor.anchor_hash:
            raise ValueError("anchor hash mismatch")
        if expected_environment_id is not None and anchor.environment_id != expected_environment_id:
            raise ValueError("anchor environment mismatch")
        if expected_release_id is not None and anchor.release_id != expected_release_id:
            raise ValueError("anchor release mismatch")


class FileAnchorStore:
    """Append-only, fsync-backed anchor sink intended to live outside the ledger store.

    It does not claim WORM semantics. In production, point the AnchorStore interface at an
    independently administered Object-Lock/WORM/transparency service.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, anchor: LedgerAnchor) -> None:
        existing = self.load()
        previous = existing[-1] if existing else None
        expected_previous = previous.anchor_hash if previous else None
        if anchor.previous_anchor_hash != expected_previous:
            raise ValueError("anchor does not extend the persisted anchor chain")
        if previous and anchor.sequence <= previous.sequence:
            raise ValueError("anchor sequence must advance")
        encoded = canonical_json(anchor.model_dump(mode="json")) + b"\n"
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, encoded)
            os.fsync(fd)
        finally:
            os.close(fd)

    def load(self) -> list[LedgerAnchor]:
        if not self.path.exists():
            return []
        anchors: list[LedgerAnchor] = []
        with self.path.open("rb") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    anchors.append(LedgerAnchor.model_validate(json.loads(line)))
                except Exception as exc:
                    raise ValueError(f"invalid anchor line {line_number}") from exc
        return anchors



class DirectoryAnchorStore:
    """One-file-per-anchor append-only sink with O_EXCL creation and directory fsync.

    This improves accidental/tamper resistance over a mutable JSONL file but is not a WORM claim.
    Put this directory on independently administered immutable/object-lock storage in production.
    """

    def __init__(self, directory: str | Path):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, anchor: LedgerAnchor) -> Path:
        return self.directory / f"{anchor.sequence:020d}-{anchor.anchor_id}.json"

    def append(self, anchor: LedgerAnchor) -> None:
        path = self._path(anchor)
        if path.exists():
            raise FileExistsError(path)
        existing = self.load()
        previous = existing[-1] if existing else None
        expected_previous = previous.anchor_hash if previous else None
        if anchor.previous_anchor_hash != expected_previous:
            raise ValueError("anchor does not extend the persisted anchor chain")
        if previous and anchor.sequence <= previous.sequence:
            raise ValueError("anchor sequence must advance")
        encoded = canonical_json(anchor.model_dump(mode="json")) + b"\n"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        try:
            os.write(fd, encoded)
            os.fsync(fd)
        finally:
            os.close(fd)
        dir_fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)

    def load(self) -> list[LedgerAnchor]:
        anchors: list[LedgerAnchor] = []
        for path in sorted(self.directory.glob("*.json")):
            try:
                anchors.append(LedgerAnchor.model_validate_json(path.read_text(encoding="utf-8")))
            except Exception as exc:
                raise ValueError(f"invalid anchor file {path.name}") from exc
        return anchors


class HttpAnchorStore:
    """Minimal synchronous HTTP adapter for an independently administered anchor service.

    Service contract:
      GET  <base_url>/anchors -> JSON array of LedgerAnchor objects
      POST <base_url>/anchors -> accepts one LedgerAnchor JSON document

    Transport availability alone does not establish WORM semantics; deployment qualification must
    verify the remote service's immutability controls separately.
    """

    def __init__(self, base_url: str, *, bearer_token: str | None = None, timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.bearer_token = bearer_token
        self.timeout = timeout

    def _request(self, method: str, *, data: bytes | None = None) -> bytes:
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        request = urllib.request.Request(
            f"{self.base_url}/anchors",
            method=method,
            data=data,
            headers=headers,
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return response.read()

    def append(self, anchor: LedgerAnchor) -> None:
        self._request("POST", data=canonical_json(anchor.model_dump(mode="json")))

    def load(self) -> list[LedgerAnchor]:
        payload = json.loads(self._request("GET"))
        if not isinstance(payload, list):
            raise ValueError("anchor service GET /anchors must return a JSON array")
        return [LedgerAnchor.model_validate(item) for item in payload]

def verify_anchor_chain(anchors: list[LedgerAnchor], keyring: AnchorKeyring) -> bool:
    previous_hash = None
    previous_sequence = 0
    try:
        for anchor in anchors:
            if anchor.previous_anchor_hash != previous_hash:
                return False
            if anchor.sequence <= previous_sequence:
                return False
            keyring.verify(anchor)
            previous_hash = anchor.anchor_hash
            previous_sequence = anchor.sequence
    except Exception:
        return False
    return True


def verify_ledger_against_anchor(ledger: HashChainLedger, anchor: LedgerAnchor) -> bool:
    """Verify the anchored prefix, detecting post-anchor mutation or suffix truncation."""
    if ledger.count < anchor.sequence:
        return False
    return ledger.hash_at(anchor.sequence) == anchor.ledger_root


def checkpoint_ledger(
    ledger: HashChainLedger,
    signer: AnchorSigner,
    store: AnchorStore,
) -> LedgerAnchor:
    if ledger.count < 1 or ledger.root is None:
        raise ValueError("cannot anchor an empty ledger")
    existing = store.load()
    previous_hash = existing[-1].anchor_hash if existing else None
    anchor = signer.sign(
        sequence=ledger.count,
        ledger_root=ledger.root,
        previous_anchor_hash=previous_hash,
    )
    store.append(anchor)
    return anchor


async def verify_async_ledger_against_anchor(ledger, anchor: LedgerAnchor) -> bool:
    count = await ledger.count()
    if count < anchor.sequence:
        return False
    return await ledger.hash_at(anchor.sequence) == anchor.ledger_root


async def checkpoint_async_ledger(ledger, signer: AnchorSigner, store: AnchorStore) -> LedgerAnchor:
    count = await ledger.count()
    root = await ledger.root()
    if count < 1 or root is None:
        raise ValueError("cannot anchor an empty ledger")
    existing = store.load()
    previous_hash = existing[-1].anchor_hash if existing else None
    anchor = signer.sign(
        sequence=count,
        ledger_root=root,
        previous_anchor_hash=previous_hash,
    )
    store.append(anchor)
    return anchor


async def checkpoint_postgres_ledger(
    ledger,
    signer: AnchorSigner,
    store: AnchorStore,
    *,
    external_location: str | None = None,
) -> LedgerAnchor:
    """Write external proof first, then mirror its metadata in PostgreSQL.

    The external sink remains authoritative for truncation detection. A database mirror is
    intentionally secondary and cannot substitute for an independently administered anchor.
    """
    anchor = await checkpoint_async_ledger(ledger, signer, store)
    await ledger.record_anchor_mirror(anchor, external_location=external_location)
    return anchor
