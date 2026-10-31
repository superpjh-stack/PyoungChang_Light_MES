"""Verify the captured legacy routes and the implemented operation registry agree."""

import json
import re
from pathlib import Path

from kkotsuni.app.errors import BusinessError
from kkotsuni.services.operations import OPERATIONS, find_operation

ROOT = Path(__file__).resolve().parents[1]


def check():
    contract = json.loads((ROOT / "contracts/api-contract.json").read_text())
    missing = []
    for item in contract["routes"]:
        concrete = re.sub(r"\{[^}]+\}", "EXAMPLE", item["path"])
        try:
            operation, _ = find_operation(item["method"], concrete)
            if operation.role != item["role"] or operation.status != item["success_status"]:
                missing.append(f"policy drift: {item['method']} {item['path']}")
        except BusinessError:
            missing.append(f"missing: {item['method']} {item['path']}")
    keys = [(op.method, op.path) for op in OPERATIONS]
    assert len(keys) == len(set(keys)), "Duplicate operation registration"
    if missing:
        raise SystemExit("\n".join(missing))
    print(
        f"PASS: {len(contract['routes'])} legacy method/path contracts; {len(OPERATIONS)} operations; role/status policies"
    )


if __name__ == "__main__":
    check()
