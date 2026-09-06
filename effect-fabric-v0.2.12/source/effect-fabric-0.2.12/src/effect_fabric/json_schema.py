from __future__ import annotations

from typing import Any

from jsonschema import SchemaError
from jsonschema.exceptions import ValidationError
from jsonschema.validators import validator_for


class JsonSchemaValidationError(ValueError):
    pass


def _error_path(error: ValidationError) -> str:
    if not error.absolute_path:
        return "$"
    parts: list[str] = ["$"]
    for part in error.absolute_path:
        if isinstance(part, int):
            parts.append(f"[{part}]")
        else:
            parts.append(f".{part}")
    return "".join(parts)


def _format_error(error: ValidationError) -> str:
    path = _error_path(error)
    if error.validator == "required":
        missing = error.validator_value
        if isinstance(error.message, str) and error.message:
            return f"{path}: {error.message}"
        return f"{path}: required property missing ({missing!r})"
    if error.validator == "additionalProperties":
        return f"{path}: {error.message}"
    return f"{path}: {error.message}"


def assert_valid_input_schema_instance(
    *, schema: dict[str, Any], instance: Any, label: str
) -> None:
    try:
        validator_cls = validator_for(schema)
        validator_cls.check_schema(schema)
        validator = validator_cls(schema)
    except SchemaError as exc:
        raise JsonSchemaValidationError(
            f"{label} pinned inputSchema is invalid: {exc.message}"
        ) from exc

    errors = sorted(
        validator.iter_errors(instance),
        key=lambda error: (tuple(error.absolute_path), error.message),
    )
    if not errors:
        return

    preview = "; ".join(_format_error(error) for error in errors[:8])
    if len(errors) > 8:
        preview = f"{preview}; ... {len(errors) - 8} more"
    raise JsonSchemaValidationError(
        f"{label} failed admitted inputSchema validation: {preview}"
    )
