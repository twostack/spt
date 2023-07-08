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
    Ripemd160,
} from 'scrypt-ts'

export class SptNft extends SmartContract {
    /**
     * Public Key Hash of the current token owner.
     * This is the PKH of whoever is allowed to transfer this token
     * under the conditions set by the issuer.
     */
    @prop(true)
    ownerPkh: PubKeyHash

    /**
     * Public Key Hash of whoever may redeem this token.
     * Typically this would be the issuer.
     */
    @prop(true)
    redemptionPubKeyHash: PubKeyHash

    /**
     * If true, token can be transferred to a third-party.
     * If false, token can only be transferred back to issuer after issuance.
     */
    @prop(true)
    isTransferrable: boolean

    /***
     * arbitrary data to be specified in token
     */
    @prop(true)
    dataBytes: ByteString

    constructor(
        ownerPkh: PubKeyHash,
        redemptionPkh: PubKeyHash,
        transferrable: boolean,
        dataBytes: ByteString
    ) {
        super(...arguments)
        this.ownerPkh = ownerPkh
        this.redemptionPubKeyHash = redemptionPkh
        this.isTransferrable = transferrable
        this.dataBytes = dataBytes
    }

    @method(SigHash.SINGLE)
    public transfer(ownerSig: Sig, currentOwner: PubKey, nextOwner: Ripemd160) {
        //authorize the transfer of ownership
        assert(
            hash160(currentOwner) == this.ownerPkh,
            'owner pubkeyhash does not match'
        )
        assert(
            this.checkSig(ownerSig, currentOwner),
            'signature verification failed'
        )

        //ensure we know who next owner is
        this.ownerPkh = nextOwner

        //assert that next owner must be issuer if token is non-transferrable
        if (!this.isTransferrable) {
            assert(this.ownerPkh == this.redemptionPubKeyHash)
        }

        const outputs: ByteString = this.buildStateOutput(this.ctx.utxo.value) //note that we explicitly preserve the amount locked sats

        // this.debug.diffOutputs(outputs)
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
