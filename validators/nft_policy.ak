// ============================================================
// CONTRACT 2: NFT MINTING POLICY
// File: validators/nft_policy.ak
//
// PURPOSE:
//   This contract controls minting and burning of the unique
//   NFT receipt token that is paired with every deposit.
//
// THE TWO RULES:
//   MINT  → Only allowed when a specific UTXO is being spent
//            (that UTXO reference is "baked in" to the contract as a param)
//            This guarantees the NFT can only EVER be minted ONCE
//            because a UTXO can only be spent once on Cardano.
//
//   BURN  → Only allowed when the multisig validator is also
//            being executed in the same transaction
//            (i.e. the ADA is being withdrawn from the multisig contract)
//
// WHY THIS DESIGN?
//   - The UTXO param makes the NFT truly unique (one-shot mint)
//   - The multisig check on burn ensures NFT can't be burned
//     without the multisig validator approving the withdrawal
//   - Together they form a "mutual verification" system
// ============================================================

use aiken/collection/dict
use aiken/collection/list
use cardano/address
use cardano/assets.{PolicyId, tokens}
use cardano/transaction.{Input, OutputReference, Transaction}

// ─────────────────────────────────────────────
// REDEEMER: What action is happening?
// ─────────────────────────────────────────────
pub type NFTAction {
  // Minting a new NFT receipt for a new deposit
  MintNFT
  // Burning the NFT receipt when withdrawing
  BurnNFT
}

// ─────────────────────────────────────────────
// HELPER: Check that a specific UTXO is being spent
// This is what makes the NFT "one-shot" — unique forever
// A UTXO can only be spent once, so this mint can only run once
// ─────────────────────────────────────────────
fn utxo_is_spent(inputs: List<Input>, utxo_ref: OutputReference) -> Bool {
  list.any(inputs, fn(input) { input.output_reference == utxo_ref })
}

// ─────────────────────────────────────────────
// HELPER: Check that exactly 1 NFT is being minted
// We never want to mint 2 or 10 — always exactly 1
// ─────────────────────────────────────────────
fn exactly_one_minted(mint: assets.Value, policy_id: PolicyId) -> Bool {
  // Get all tokens minted under this policy
  let minted_tokens = tokens(mint, policy_id) |> dict.to_pairs()
  when minted_tokens is {
    // There must be exactly ONE token name entry
    [Pair(_, quantity)] ->
      // Quantity must be exactly 1
      quantity == 1
    // Zero tokens or multiple token names = rejected
    _ -> False
  }
}

// ─────────────────────────────────────────────
// HELPER: Check that exactly 1 NFT is being burned
// Burn = quantity of -1
// ─────────────────────────────────────────────
fn exactly_one_burned(mint: assets.Value, policy_id: PolicyId) -> Bool {
  let minted_tokens = tokens(mint, policy_id) |> dict.to_pairs()
  when minted_tokens is {
    [Pair(_, quantity)] ->
      // Quantity -1 = burning exactly one NFT
      quantity == -1
    _ -> False
  }
}

// ─────────────────────────────────────────────
// HELPER: Check that the multisig validator script is
// being executed in this transaction (as an input being spent)
//
// HOW: We check that one of the transaction inputs comes from
// the multisig script address (identified by its script hash)
//
// WHY: This ensures you can't burn the NFT without the multisig
// contract also running and approving the withdrawal
// ─────────────────────────────────────────────
fn multisig_script_is_executing(
  inputs: List<Input>,
  multisig_script_hash: ByteArray,
) -> Bool {
  list.any(
    inputs,
    fn(input) {
      when input.output.address.payment_credential is {
        // Check if this input comes from a script address
        address.Script(script_hash) ->
          // And that script hash matches our multisig validator
          script_hash == multisig_script_hash
        // Regular wallet addresses are ignored
        _ -> False
      }
    },
  )
}

// ─────────────────────────────────────────────
// MAIN VALIDATOR
//
// Parameters (baked in at deploy time):
//   utxo_ref         — the specific UTXO that must be spent to mint
//                      This makes each NFT unique forever
//   multisig_hash    — the script hash of the multisig validator
//                      Used to verify the multisig is running on burn
// ─────────────────────────────────────────────
validator nft_policy(
  // The UTXO that must be consumed when minting
  // This "one-shot" pattern guarantees uniqueness
  utxo_ref: OutputReference,
  // The script hash of the multisig validator
  // Needed to verify it's executing during burn
  multisig_hash: ByteArray,
) {
  mint(
    // What the user wants to do (MintNFT or BurnNFT)
    action: NFTAction,
    // This policy's own ID (auto-provided by Cardano)
    policy_id: PolicyId,
    // Full transaction context
    transaction: Transaction,
  ) {
    let Transaction { inputs, mint, .. } = transaction

    when action is {
      // ══ ACTION: MINT ══
      // Creating a new NFT receipt for a new deposit
      MintNFT -> {
        // Rule 1: The specified UTXO must be spent in this transaction
        //         This is what makes the NFT "one-shot" and unique
        //         Once this UTXO is spent, it's gone — can never mint again
        let utxo_spent = utxo_is_spent(inputs, utxo_ref)

        // Rule 2: Exactly 1 NFT must be minted (not 0, not 2)
        let one_minted = exactly_one_minted(mint, policy_id)

        utxo_spent && one_minted
      }

      // ══ ACTION: BURN ══
      // Destroying the NFT receipt when ADA is withdrawn
      BurnNFT -> {
        // Rule 1: The multisig validator must be running in this tx
        //         This ensures the multisig approved the withdrawal
        //         You can't burn the NFT without going through the contract
        let multisig_running =
          multisig_script_is_executing(inputs, multisig_hash)

        // Rule 2: Exactly 1 NFT is being burned (quantity = -1)
        let one_burned = exactly_one_burned(mint, policy_id)

        multisig_running && one_burned
      }
    }
  }

  // This validator only handles 'mint' — no other purposes
  else(_) {
    fail
  }
}
