from effect_fabric.ledger import HashChainLedger


def test_chain_verifies_and_detects_tamper():
    ledger = HashChainLedger()
    ledger.append("t", "one", {"x": 1})
    ledger.append("t", "two", {"x": 2})
    assert ledger.verify()
    original = ledger._events[1]
    ledger._events[1] = original.model_copy(update={"payload": {"x": 999}})
    assert not ledger.verify()


def test_root_changes_with_new_event():
    ledger = HashChainLedger()
    ledger.append("t", "one")
    r1 = ledger.root
    ledger.append("t", "two")
    assert ledger.root != r1
