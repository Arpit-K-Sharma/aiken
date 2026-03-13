// ============================================================
// CONTRACT 1: MULTISIG SPEND VALIDATOR
// File: validators/multisig_validator.ak
//
// PURPOSE:
//   This contract guards ADA locked at the script address.
//   It only allows spending when:
//     1. Enough authorized signers have signed (threshold met)
//     2. The NFT receipt token is handled correctly
//        (stays when updating, burned when fully withdrawing)
//     3. The datum is returned in the correct format
//
// HOW IT WORKS:
//   - ADA is locked here WITH a unique NFT (the receipt token)
//   - The datum contains [pkh[], threshold] — who can sign and how many
//   - On spend: check signatures, check NFT, check datum format
// ============================================================

use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets.{PolicyId, quantity_of}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}

// ─────────────────────────────────────────────
// DATUM: stored inside the locked UTXO
// This tells the contract WHO can sign and HOW MANY must sign
// ─────────────────────────────────────────────
pub type MultisigDatum {
  // List of public key hashes of authorized signers
  // e.g. [alice_pkh, bob_pkh, charlie_pkh]
  signers: List<VerificationKeyHash>,
  // Minimum number of signatures required to approve a tx
  // e.g. threshold = 2 means 2 out of 3 must sign
  threshold: Int,
  // The NFT policy id that was minted for this specific UTXO
  // Used to identify WHICH NFT belongs to this deposit
  nft_policy: PolicyId,
}

// ─────────────────────────────────────────────
// REDEEMER: the "instruction" sent when spending
// The person spending tells the contract WHAT they want to do
// ─────────────────────────────────────────────
pub type MultisigRedeemer {
  // Spend: fully withdraw the ADA and BURN the NFT
  Spend
  // Update: change signers or threshold, NFT stays locked
  Update { new_signers: List<VerificationKeyHash>, new_threshold: Int }
}

// ─────────────────────────────────────────────
// HELPER: Count how many signers from the datum
// have actually signed this transaction
// ─────────────────────────────────────────────
fn count_valid_signatures(
  signers: List<VerificationKeyHash>,
  tx_signatories: List<VerificationKeyHash>,
) -> Int {
  list.foldl(
    signers,
    0,
    fn(signer, count) {
      if list.has(tx_signatories, signer) {
        count + 1
      } else {
        count
      }
    },
  )
}

// ─────────────────────────────────────────────
// HELPER: Check that threshold of signatures is met
// e.g. if threshold=2, at least 2 signers must have signed
// ─────────────────────────────────────────────
fn threshold_met(
  datum: MultisigDatum,
  tx_signatories: List<VerificationKeyHash>,
) -> Bool {
  let valid_sigs = count_valid_signatures(datum.signers, tx_signatories)
  valid_sigs >= datum.threshold
}

// ─────────────────────────────────────────────
// HELPER: Find the output that goes back to the script address
// When updating, the NFT+ADA must be returned to the contract
// ─────────────────────────────────────────────
fn find_script_output(
  outputs: List<Output>,
  script_address: Address,
) -> Option<Output> {
  list.find(outputs, fn(output) { output.address == script_address })
}

// ─────────────────────────────────────────────
// HELPER: Check that the NFT is being BURNED in this transaction
// burn = minting a quantity of -1 for that policy
// ─────────────────────────────────────────────
fn nft_is_burned(mint: assets.Value, nft_policy: PolicyId) -> Bool {
  // The NFT token name is "" (empty) — one NFT per deposit
  let nft_token_name = ""
  quantity_of(mint, nft_policy, nft_token_name) == -1
}

// ─────────────────────────────────────────────
// HELPER: Validate the datum returned to the script is well-formed
// When updating, you must send back a valid MultisigDatum
// ─────────────────────────────────────────────
fn valid_datum_returned(output: Output) -> Bool {
  when output.datum is {
    // The datum must be inline (stored on-chain, not just hashed)
    InlineDatum(raw_datum) -> {
      // Try to decode it as MultisigDatum
      expect datum: MultisigDatum = raw_datum
      // Signers list must not be empty
      // Threshold must be at least 1
      // Threshold cannot exceed number of signers (that would be impossible)
      !list.is_empty(datum.signers) && datum.threshold >= 1 && datum.threshold <= list.length(
        datum.signers,
      )
    }
    // Any other datum format is rejected
    _ -> False
  }
}

// ─────────────────────────────────────────────
// MAIN VALIDATOR
// This is the actual smart contract logic
// ─────────────────────────────────────────────
validator multisig_validator {
  spend(
    // The datum stored in the locked UTXO (who can sign, threshold, nft policy)
    datum_opt: Option<MultisigDatum>,
    // The redeemer (what action: Spend or Update)
    redeemer: MultisigRedeemer,
    // Reference to the UTXO being spent (its location on chain)
    own_ref: OutputReference,
    // The full transaction context
    transaction: Transaction,
  ) {
    // ── STEP 1: Unwrap the datum (fail if missing) ──
    // Every UTXO locked here must have a datum
    expect Some(datum) = datum_opt

    let Transaction { inputs, outputs, extra_signatories, mint, .. } =
      transaction

    // ── STEP 2: Find the UTXO being spent (to get its address) ──
    // We need the script's own address to check outputs going back to it
    expect Some(own_input) =
      list.find(inputs, fn(input) { input.output_reference == own_ref })
    let script_address = own_input.output.address

    // ── STEP 3: Check THRESHOLD — enough signers must have signed ──
    let sigs_ok = threshold_met(datum, extra_signatories)

    // ── STEP 4: Handle based on redeemer action ──
    when redeemer is {
      // ══ ACTION: SPEND (full withdrawal) ══
      // User wants to take out the ADA entirely
      // The NFT MUST be burned in this transaction
      Spend ->
        // Check 1: Enough signatures
        // Check 2: NFT is being burned (quantity = -1)
        sigs_ok && nft_is_burned(mint, datum.nft_policy)

      // ══ ACTION: UPDATE (change signers/threshold) ══
      // User wants to update who can sign or how many needed
      // The NFT must STAY locked (returned to script with new datum)
      Update { new_signers, new_threshold } -> {
        // Find the output going back to this script address
        let maybe_script_output = find_script_output(outputs, script_address)

        when maybe_script_output is {
          Some(script_output) -> {
            // Check 1: Enough signatures from OLD signers (to authorize update)
            // Check 2: New threshold is valid (>= 1, <= new signers count)
            // Check 3: The output back to script has a valid datum
            // Check 4: The NFT is still present in the output
            let new_threshold_valid =
              new_threshold >= 1 && new_threshold <= list.length(new_signers)
            let datum_ok = valid_datum_returned(script_output)
            let nft_still_present =
              quantity_of(script_output.value, datum.nft_policy, "") == 1

            sigs_ok && new_threshold_valid && datum_ok && nft_still_present
          }
          // No output back to script = rejected
          None -> False
        }
      }
    }
  }

  // This validator only handles 'spend' — no other purposes
  else(_) {
    fail
  }
}
