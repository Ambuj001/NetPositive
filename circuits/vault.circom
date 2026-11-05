pragma circom 2.2.2;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

// Statement: knowledge of nonzero secret and salt committed to this encrypted
// envelope digest, caller and deployment scope. Not a voucher-validity proof.
template VaultRecord() {
    signal input secret;
    signal input salt;
    signal input digest;
    signal input owner;
    signal input scope;
    signal output commitment;
    signal output nullifier;
    component nonzero = IsZero();
    nonzero.in <== secret;
    nonzero.out === 0;
    component addressBits = Num2Bits(160);
    addressBits.in <== owner;
    component record = Poseidon(5);
    record.inputs[0] <== secret;
    record.inputs[1] <== salt;
    record.inputs[2] <== digest;
    record.inputs[3] <== owner;
    record.inputs[4] <== scope;
    commitment <== record.out;
    component unique = Poseidon(2);
    unique.inputs[0] <== secret;
    unique.inputs[1] <== scope;
    nullifier <== unique.out;
}
component main {public [digest, owner, scope]} = VaultRecord();
