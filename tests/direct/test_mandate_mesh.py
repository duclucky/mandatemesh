import json
import sys
from datetime import datetime, timezone

import pytest


GEN = 10**18
BASE_TIME = 1_893_456_000
PROPOSAL_DEADLINE = BASE_TIME + 100
RECOVERY_DEADLINE = BASE_TIME + 200


def set_time(vm, timestamp):
    text = datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")
    vm.warp(text)
    module = sys.modules.get("genlayer.message")
    if module is not None:
        module.raw["datetime"] = text
        module.datetime = text


def deploy_round(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/mandate_mesh.py")
    set_time(direct_vm, BASE_TIME)
    set_time(direct_vm, BASE_TIME)
    direct_vm.sender = direct_alice
    direct_vm.value = 2 * GEN
    contract.create_round("round-1", direct_bob, direct_charlie, direct_alice, PROPOSAL_DEADLINE, RECOVERY_DEADLINE)
    return contract


def test_round_requires_exactly_two_gen(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/mandate_mesh.py")
    direct_vm.sender = direct_alice
    direct_vm.value = GEN
    with direct_vm.expect_revert("exactly 2 GEN"):
        contract.create_round("round-1", direct_bob, direct_charlie, direct_alice, PROPOSAL_DEADLINE, RECOVERY_DEADLINE)


def test_submit_is_one_per_registered_proposer_and_deadline_is_local(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = deploy_round(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    set_time(direct_vm, PROPOSAL_DEADLINE - 1)
    direct_vm.sender = direct_bob
    contract.submit_plan("round-1", "food-access plan")
    with direct_vm.expect_revert("already submitted"):
        contract.submit_plan("round-1", "duplicate")
    direct_vm.sender = direct_charlie
    set_time(direct_vm, PROPOSAL_DEADLINE)
    before = contract.get_round("round-1")
    with direct_vm.expect_revert("proposal deadline"):
        contract.submit_plan("round-1", "late despite stale OPEN")
    assert contract.get_round("round-1") == before


def test_only_sponsor_can_freeze_after_deadline(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = deploy_round(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_alice
    set_time(direct_vm, PROPOSAL_DEADLINE - 1)
    with direct_vm.expect_revert("proposal deadline has not passed"):
        contract.freeze_round("round-1")
    set_time(direct_vm, PROPOSAL_DEADLINE)
    contract.freeze_round("round-1")
    assert json.loads(contract.get_round("round-1"))["phase"] == "FROZEN"


def test_expiry_recovery_is_sponsor_only_and_keeps_accounting_safe(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = deploy_round(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_alice
    set_time(direct_vm, PROPOSAL_DEADLINE)
    contract.freeze_round("round-1")
    set_time(direct_vm, RECOVERY_DEADLINE)
    direct_vm.sender = direct_bob
    before = contract.get_round("round-1")
    with direct_vm.expect_revert("only sponsor"):
        contract.recover_expired("round-1")
    assert contract.get_round("round-1") == before
    direct_vm.sender = direct_alice
    contract.recover_expired("round-1")
    record = json.loads(contract.get_round("round-1"))
    assert record["phase"] == "EXPIRED_REFUNDED"
    assert record["remaining_liability"] == "0"
