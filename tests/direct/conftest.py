import os
import tempfile
from pathlib import Path

import pytest
from gltest.direct import loader, sdk_loader
from gltest.direct.loader import deploy_contract
from gltest.direct.vm import VMContext


sdk_loader.CACHE_DIR = Path(__file__).resolve().parents[2] / ".genvm-direct-cache"
sdk_loader.BUNDLE_CACHE_DIR = sdk_loader.CACHE_DIR / "bundles-v2"
sdk_loader.TREE_CACHE_DIR = sdk_loader.CACHE_DIR / "trees-v2"


def _inject_message_to_fd0(vm: VMContext) -> None:
    from genlayer import calldata
    from genlayer.types import Address
    sender = Address(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
    contract = Address(vm._contract_address) if isinstance(vm._contract_address, bytes) else vm._contract_address
    origin = Address(vm.origin) if isinstance(vm.origin, bytes) else vm.origin
    encoded = calldata.encode({"contract_address": contract, "sender_address": sender, "origin_address": origin,
        "stack": [], "value": vm._value, "datetime": vm._datetime, "is_init": False, "chain_id": vm._chain_id,
        "entry_kind": 0, "entry_data": b"", "entry_stage_data": None})
    fd, path = tempfile.mkstemp()
    try:
        os.write(fd, encoded)
        os.lseek(fd, 0, os.SEEK_SET)
        vm._original_stdin_fd = os.dup(0)
        os.dup2(fd, 0)
        vm._mandatemesh_stdin_path = path
    finally:
        os.close(fd)


_original_cleanup = VMContext._cleanup_after_deactivate
def _cleanup(self):
    try:
        _original_cleanup(self)
    finally:
        path = getattr(self, "_mandatemesh_stdin_path", None)
        if path:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass


loader._inject_message_to_fd0 = _inject_message_to_fd0
VMContext._cleanup_after_deactivate = _cleanup
_original_load_module = loader._load_module
def _load_module_with_fresh_contract_registry(contract_path):
    import genlayer.contract as contract_api
    contract_api.__known_contract__ = None
    return _original_load_module(contract_path)
loader._load_module = _load_module_with_fresh_contract_registry


@pytest.fixture
def direct_deploy(direct_vm):
    def _deploy(contract_path: str):
        return deploy_contract((Path.cwd() / contract_path).resolve(), direct_vm, sdk_version="v0.6.0-rc5")
    return _deploy
