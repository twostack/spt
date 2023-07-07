import {
    PubKeyHash,
    SmartContract,
    prop,
    assert,
    method,
    hash160,
    Sig,
    PubKey,
    SigHash,
    ByteString,
    hash256,
} from 'scrypt-ts'

export class SptNft extends SmartContract {
    @prop(true)
    ownerPkh: PubKeyHash

    @prop(true)
    redemptionPubKeyHash: PubKeyHash

    constructor(ownerPkh: PubKeyHash, redemptionPkh: PubKeyHash) {
        super(...arguments)
        this.ownerPkh = ownerPkh
        this.redemptionPubKeyHash = redemptionPkh
    }

    @method(SigHash.SINGLE)
    public transfer(ownerSig: Sig, currentOwner: PubKey) {
        //authorize the transfer of ownership
        assert(
            hash160(currentOwner) == this.ownerPkh,
            'owner pubkeyhash does not match'
        )
        assert(
            this.checkSig(ownerSig, currentOwner),
            'signature verification failed'
        )

        // this.ownerPkh = newOwner
        const outputs: ByteString = this.buildStateOutput(this.ctx.utxo.value) //note that we explicitly preserve the amount locked sats

        // outputs += this.buildChangeOutput()

        assert(
            this.ctx.hashOutputs == hash256(outputs),
            'hashOutputs has a mismatch'
        )
    }

    @method()
    public redeem(
        ownerSig: Sig,
        ownerPubKey: PubKey,
        redeemerSig: Sig,
        redeemerPubKey: PubKey
    ) {
        //redeemer agrees
        assert(
            hash160(redeemerPubKey) == this.redemptionPubKeyHash,
            'issuer public key does not match'
        )
        assert(
            this.checkSig(redeemerSig, redeemerPubKey),
            'issuer signature is invalid'
        )

        //owner agrees
        assert(
            hash160(ownerPubKey) == this.ownerPkh,
            'token owner public key does not match'
        )
        assert(
            this.checkSig(ownerSig, ownerPubKey),
            'token owner signature is invalid'
        )
    }
}
