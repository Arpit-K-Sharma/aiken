use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{OutputReference, Transaction}



pub type Datum {
    owners: List<VerificationKeyHash>,
    threshold: Int,
}

pub type Redeemer { Spend }

validator multisig {
    spend(
        datum: Option<Datum>,
        _redeemer: Redeemer,
        _own_ref: OutputReference,
        self: Transaction,
    ) {
        let version = 1
        expect version == 1
        expect Some(Datum {owners, threshold}) = datum

        let signatures = list.filter(owners, fn(owner) { list.has(self.extra_signatories, owner)})
        let num_signatures = list.length(signatures)

        num_signatures >= threshold

    }

    else(_){
        fail
    }
}


test multisig_two_of_three(){
    let owner1 = #"11111111111111111111111111111111111111111111111111111111"
    let owner2 = #"22222222222222222222222222222222222222222222222222222222"
    let owner3 = #"33333333333333333333333333333333333333333333333333333333"

    let datum = Datum { owners: [owner1, owner2, owner3], threshold: 2}

    let redeemer = Spend

    let placeholder_utxo = OutputReference { transaction_id: #"", output_index: 0}

// Case: owner1 and owner2 sign
    expect _ = multisig.spend(
        Some(datum),
        redeemer,
        placeholder_utxo,
        Transaction { ..transaction.placeholder, extra_signatories: [owner1, owner2] },
        )


    // Case: only owner1 signs (should fail)
    expect _ = multisig.spend(
        Some(datum),
        redeemer,
        placeholder_utxo,
        Transaction { ..transaction.placeholder, extra_signatories: [owner1] },
    )


    // Case: all three sign (should pass)
        multisig.spend(
        Some(datum),
        redeemer,
        placeholder_utxo,
        Transaction { ..transaction.placeholder, extra_signatories: [owner1, owner2, owner3] },
        )


}