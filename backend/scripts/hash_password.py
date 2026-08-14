"""Generate an ADMIN_PASSWORD_HASH + ADMIN_SESSION_SECRET pair."""

from __future__ import annotations

import argparse
import getpass
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from tournament.admin_auth import hash_password  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--password", help="Admin password (prompted if omitted)")
    args = parser.parse_args()
    password = args.password or getpass.getpass("Admin password: ")
    print(f"ADMIN_PASSWORD_HASH={hash_password(password)}")
    print(f"ADMIN_SESSION_SECRET={secrets.token_hex(32)}")


if __name__ == "__main__":
    main()
