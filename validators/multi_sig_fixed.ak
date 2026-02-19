use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}

// --- Fixed Configuration ---
// Threshold: 2 out of 3 owners must sign

const threshold: Int = 2

const owner1: VerificationKeyHash =
  #"f06e37f07bdd03ee357d66a4431ab5a36138013094d4c336a51e5eeb"

const owner2: VerificationKeyHash =
  #"29f661e46b0f0b708d2509319997a848ac083bff56a0cb0f39c94e5c"

const owner3: VerificationKeyHash =
  #"3aa33a370ea3f66fbf1375d40e3f62e9e6ee06077abc83e360deb2e0"

fn owners() -> List<VerificationKeyHash> {
  [owner1, owner2, owner3]
}

// --- Types ---

pub type Redeemer {
  Spend
}

// --- Validator ---

validator multisig_fixed {
  spend(
    _datum: Option<Data>,
    _redeemer: Redeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    let signatures =
      list.filter(
        owners(),
        fn(owner) { list.has(self.extra_signatories, owner) },
      )

    let num_signatures = list.length(signatures)

    num_signatures >= threshold
  }

  else(_) {
    fail
  }
}

// --- Tests ---

test multisig_fixed_two_of_three_pass() {
  let redeemer = Spend
  let placeholder_utxo =
    OutputReference { transaction_id: #"", output_index: 0 }

  // owner1 and owner2 sign — should pass (2 >= 2)
  multisig_fixed.spend(
    None,
    redeemer,
    placeholder_utxo,
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner1, owner2],
    },
  )
}

test multisig_fixed_all_three_pass() {
  let redeemer = Spend
  let placeholder_utxo =
    OutputReference { transaction_id: #"", output_index: 0 }

  // All three sign — should pass (3 >= 2)
  multisig_fixed.spend(
    None,
    redeemer,
    placeholder_utxo,
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner1, owner2, owner3],
    },
  )
}

test multisig_fixed_one_of_three_fail() {
  let redeemer = Spend
  let placeholder_utxo =
    OutputReference { transaction_id: #"", output_index: 0 }

  // Only owner1 signs — should fail (1 < 2)
  !multisig_fixed.spend(
    None,
    redeemer,
    placeholder_utxo,
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [owner1],
    },
  )
}

test multisig_fixed_no_signers_fail() {
  let redeemer = Spend
  let placeholder_utxo =
    OutputReference { transaction_id: #"", output_index: 0 }

  // No signers — should fail (0 < 2)
  !multisig_fixed.spend(
    None,
    redeemer,
    placeholder_utxo,
    Transaction { ..transaction.placeholder, extra_signatories: [] },
  )
}

test multisig_fixed_unknown_signer_fail() {
  let redeemer = Spend
  let placeholder_utxo =
    OutputReference { transaction_id: #"", output_index: 0 }

  let stranger =
    #"99999999999999999999999999999999999999999999999999999999"

  // Stranger + owner1 sign — only 1 valid owner (1 < 2), should fail
  !multisig_fixed.spend(
    None,
    redeemer,
    placeholder_utxo,
    Transaction {
      ..transaction.placeholder,
      extra_signatories: [stranger, owner1],
    },
  )
}
