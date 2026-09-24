import ast
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest


GEN = 10**18
BASE_TIME = 1_893_456_000
PROPOSAL_DEADLINE = BASE_TIME + 100
RECOVERY_DEADLINE = BASE_TIME + 200
EXPECTED_CONFIG_DIGEST = "09c4c9ad79f9f9432b36d0a4b21eb7138ee745abb46543badac92cce1e470633"
EXPECTED_MANDATE_TEXTS = [
    "Job Training for Young Adults and Adults in Trade Work: The program will provide vocational training to people 18 years old and up. They will learn how to be independent contractors and get commercial and city contracts. At the end of the program job fairs will make solid connections.",
    "Healthy Meals Partnership: Restaurants will partner with local food pantries to provide healthy meals. Families will pick up the food at monthly healthy food workshops focused on health issues. Services will be multilingual.",
    "Bridging the Skills Gaps: Job Training for High Schoolers: Prepare HS students with career readiness programs that include workshops led by professionals. Activities may include resume-building, mock interviews, and networking to connect students with opportunities.",
]


def enable_direct_non_comparative_adapter(monkeypatch):
    """Direct mode lacks ExecPromptTemplate; Studio smoke covers the real primitive."""
    gl = sys.modules["genlayer"]

    def execute_review(review_input, *, task, criteria):
        del task, criteria
        return gl.nondet.exec_prompt(review_input(), response_format="json")

    monkeypatch.setattr(gl.eq_principle, "prompt_non_comparative", execute_review)


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


def prepare_review(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = deploy_round(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    set_time(direct_vm, PROPOSAL_DEADLINE - 1)
    direct_vm.sender = direct_bob
    contract.submit_plan("round-1", "food access plan")
    direct_vm.sender = direct_charlie
    contract.submit_plan("round-1", "skills plan")
    direct_vm.sender = direct_alice
    set_time(direct_vm, PROPOSAL_DEADLINE)
    contract.freeze_round("round-1")
    bob_key = "round-1|" + direct_bob.as_hex.lower()
    charlie_key = "round-1|" + direct_charlie.as_hex.lower()
    return contract, bob_key, charlie_key


def complete_payload(bob_key, charlie_key, config_digest=EXPECTED_CONFIG_DIGEST):
    payload = {"round_id": "round-1", "config_digest": config_digest, "attempt_id": 1, "cells": [
        {"proposal_id": bob_key, "mandate_id": "M1", "coverage": "SUBSTANTIVE"},
        {"proposal_id": bob_key, "mandate_id": "M2", "coverage": "NONE"},
        {"proposal_id": bob_key, "mandate_id": "M3", "coverage": "NONE"},
        {"proposal_id": charlie_key, "mandate_id": "M1", "coverage": "NONE"},
        {"proposal_id": charlie_key, "mandate_id": "M2", "coverage": "SUBSTANTIVE"},
        {"proposal_id": charlie_key, "mandate_id": "M3", "coverage": "NONE"},
    ]}
    if config_digest is None:
        del payload["config_digest"]
    return payload


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
    assert record["remaining_liability"] == str(2 * GEN)
    assert record["sponsor_credit"] == str(2 * GEN)
    contract.withdraw_sponsor_credit("round-1")
    record = json.loads(contract.get_round("round-1"))
    assert record["remaining_liability"] == "0"
    assert record["sponsor_credit"] == "0"


def test_complete_matrix_creates_credit_and_prevents_double_withdrawal(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, monkeypatch
):
    contract, bob_key, charlie_key = prepare_review(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
    )
    payload = complete_payload(bob_key, charlie_key)
    enable_direct_non_comparative_adapter(monkeypatch)
    direct_vm.mock_llm(r"(?s).*Return JSON only.*", json.dumps(json.dumps(payload)))
    direct_vm.sender = direct_alice
    contract.adjudicate_round("round-1")
    assert json.loads(contract.get_round("round-1"))["phase"] == "ALLOCATED"
    assert json.loads(contract.get_credit("round-1", direct_bob))["amount"] == str((2 * GEN) // 3)
    direct_vm.sender = direct_bob
    contract.withdraw_credit("round-1")
    assert json.loads(contract.get_credit("round-1", direct_bob))["withdrawn"] is True
    with direct_vm.expect_revert("already withdrawn"):
        contract.withdraw_credit("round-1")


def test_mandate_configuration_exposes_exact_text_digests_and_criteria(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/mandate_mesh.py")

    config = json.loads(contract.get_mandate_config())

    assert config["config_digest"] == EXPECTED_CONFIG_DIGEST
    assert [item["id"] for item in config["mandates"]] == ["M1", "M2", "M3"]
    assert [item["text"] for item in config["mandates"]] == EXPECTED_MANDATE_TEXTS
    assert all(item["digest"] == hashlib.sha256(item["text"].encode()).hexdigest()
        for item in config["mandates"])
    assert set(config["criteria"]) == {"SUBSTANTIVE", "PARTIAL", "NONE"}

    prompt = contract._build_review_prompt("round-1", 1, [{"proposal_id": "p1", "text": "plan"}], config)
    assert EXPECTED_CONFIG_DIGEST in prompt
    assert all(text in prompt for text in EXPECTED_MANDATE_TEXTS)
    assert all(config["criteria"][label] in prompt for label in ("SUBSTANTIVE", "PARTIAL", "NONE"))


def test_validator_audits_with_the_same_bound_mandates_and_criteria():
    tree = ast.parse(Path("contracts/mandate_mesh.py").read_text(encoding="ascii"))
    adjudicate = next(node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "adjudicate_round")
    review_prompt_builds = [node for node in ast.walk(adjudicate)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        and node.func.attr == "_build_review_prompt"]
    validator_criteria_builds = [node for node in ast.walk(adjudicate)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        and node.func.attr == "_build_validator_criteria"]
    non_comparative_calls = [node for node in ast.walk(adjudicate)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        and node.func.attr == "prompt_non_comparative"]

    assert len(review_prompt_builds) == 1
    assert len(validator_criteria_builds) == 1
    assert len(non_comparative_calls) == 1


def test_validator_criteria_bind_exact_config_and_all_criteria(direct_deploy):
    contract = direct_deploy("contracts/mandate_mesh.py")
    config = json.loads(contract.get_mandate_config())
    criteria = contract._build_validator_criteria(
        "round-1", 1, [{"proposal_id": "p1", "text": "plan", "digest": "d"}], config
    )

    assert EXPECTED_CONFIG_DIGEST in criteria
    assert all(text in criteria for text in EXPECTED_MANDATE_TEXTS)
    assert all(config["criteria"][label] in criteria for label in ("SUBSTANTIVE", "PARTIAL", "NONE"))
    assert "SUBSTANTIVE" in criteria and "Reject an omitted" in criteria


@pytest.mark.parametrize("config_digest", [None, "0" * 64])
def test_missing_or_changed_result_config_cannot_create_payout_credits(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, config_digest, monkeypatch
):
    contract, bob_key, charlie_key = prepare_review(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
    )
    payload = complete_payload(bob_key, charlie_key, config_digest)
    enable_direct_non_comparative_adapter(monkeypatch)
    direct_vm.mock_llm(r"(?s).*Return JSON only.*", json.dumps(json.dumps(payload)))

    contract.adjudicate_round("round-1")

    round_view = json.loads(contract.get_round("round-1"))
    assert round_view["phase"] == "RETRYABLE"
    assert round_view["remaining_liability"] == str(2 * GEN)
    assert json.loads(contract.get_credit("round-1", direct_bob))["amount"] == "0"
    assert json.loads(contract.get_credit("round-1", direct_charlie))["amount"] == "0"


@pytest.mark.parametrize("mutation", ["changed", "missing"])
def test_changed_or_missing_stored_mandate_cannot_create_payout_credits(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, mutation
):
    contract, bob_key, charlie_key = prepare_review(
        direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
    )
    if mutation == "changed":
        contract.mandate_texts["M1"] = "tampered mandate"
    else:
        del contract.mandate_texts["M1"]
    payload = complete_payload(bob_key, charlie_key)
    direct_vm.mock_llm(r"(?s).*Return JSON only.*", json.dumps(json.dumps(payload)))

    contract.adjudicate_round("round-1")

    round_view = json.loads(contract.get_round("round-1"))
    assert round_view["phase"] == "RETRYABLE"
    assert round_view["remaining_liability"] == str(2 * GEN)
    assert json.loads(contract.get_credit("round-1", direct_bob))["amount"] == "0"
    assert json.loads(contract.get_credit("round-1", direct_charlie))["amount"] == "0"
