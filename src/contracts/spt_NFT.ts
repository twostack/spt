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
    @prop(true)
    ownerPkh: PubKeyHash

    @prop(true)
    redemptionPubKeyHash: PubKeyHash

    @prop(true)
    isTransferrable: boolean

    constructor(
        ownerPkh: PubKeyHash,
        redemptionPkh: PubKeyHash,
        transferrable: boolean
    ) {
        super(...arguments)
        this.ownerPkh = ownerPkh
        this.redemptionPubKeyHash = redemptionPkh
        this.isTransferrable = transferrable
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
