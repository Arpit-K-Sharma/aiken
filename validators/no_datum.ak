use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}
use cardano/transaction

pub type MultisigDatum {
  threshold: Int,
}

pub type MultisigRedeemer {
  Spend
}

validator nodatum(
  owner1: VerificationKeyHash,
  owner2: VerificationKeyHash,
  owner3: VerificationKeyHash,
) {
  spend(
    datum: Option<MultisigDatum>,
    _redeemer: MultisigRedeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(MultisigDatum { threshold }) = datum
    let owners = [owner1, owner2, owner3]
    let signatures = self.extra_signatories
    let valid_signatures =
      list.filter(signatures, fn(sign) { list.has(owners, sign) })
    list.length(valid_signatures) >= threshold
  }

  else(_) {
    fail
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const owner1: VerificationKeyHash =
  #"11111111111111111111111111111111111111111111111111111111"

const owner2: VerificationKeyHash =
  #"22222222222222222222222222222222222222222222222222222222"

const owner3: VerificationKeyHash =
  #"33333333333333333333333333333333333333333333333333333333"

const placeholder_utxo =
  OutputReference { transaction_id: #"", output_index: 0 }

// ✅ 1-of-3: owner1 signs, threshold = 1 → should PASS
test passes_one_of_three() {
  let datum = Some(MultisigDatum { threshold: 1 })
  let tx =
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner1],
    }
  nodatum.spend(owner1, owner2, owner3, datum, Spend, placeholder_utxo, tx)
}

// ✅ 2-of-3: owner1 + owner2 sign, threshold = 2 → should PASS
test passes_two_of_three() {
  let datum = Some(MultisigDatum { threshold: 2 })
  let tx =
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner1, owner2],
    }
  nodatum.spend(owner1, owner2, owner3, datum, Spend, placeholder_utxo, tx)
}

// ✅ 3-of-3: all sign, threshold = 2 → should PASS (more than enough)
test passes_all_sign_threshold_two() {
  let datum = Some(MultisigDatum { threshold: 2 })
  let tx =
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner1, owner2, owner3],
    }
  nodatum.spend(owner1, owner2, owner3, datum, Spend, placeholder_utxo, tx)
}

// ❌ threshold = 2 but only 1 signs → should FAIL (returns False)
test fails_insufficient_signatures() {
  let datum = Some(MultisigDatum { threshold: 2 })
  let tx =
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner1],
    }
  !nodatum.spend(owner1, owner2, owner3, datum, Spend, placeholder_utxo, tx)
}

// ❌ stranger signs (not an owner) → should FAIL
test fails_stranger_signature() {
  let stranger =
    #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  let datum = Some(MultisigDatum { threshold: 1 })
  let tx =
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [stranger],
    }
  !nodatum.spend(owner1, owner2, owner3, datum, Spend, placeholder_utxo, tx)
}

// ❌ no signatures at all → should FAIL
test fails_no_signatures() {
  let datum = Some(MultisigDatum { threshold: 1 })
  let tx =
    Transaction { ..transaction.placeholder, extra_signatories: [] }
  !nodatum.spend(owner1, owner2, owner3, datum, Spend, placeholder_utxo, tx)
}