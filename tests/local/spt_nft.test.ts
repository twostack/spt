import { expect } from 'chai'
import { SptNft } from '../../src/contracts/spt_NFT'
import { getDummyUTXO } from '../utils/txHelper'
import {
    DummyProvider,
    TestWallet,
    bsv,
    MethodCallOptions,
    Ripemd160,
    hash160,
    SignatureResponse,
    PubKey,
    utxoFromOutput,
    SignatureHashType,
    findSig,
} from 'scrypt-ts'

describe('Test SmartContract `SptNft`', () => {
    const aliceWif = 'cQbzzK3rgvPzMqAyzPYFyoJXS8qchTS1Q9ByvWfZt9BdQc36DxzQ'
    const bobWif = 'cMwQqYsDg2jeTdrCrRd7SCB5U5yw6GbTbQGAQemNYJpqLfh1utVB'
    const issuerWif = 'cQEXRXLwzsE8MiqWnXqxRnp3nr2HSh5hWcmrQqPk97uFyMX2bgG6'

    const aliceKey = bsv.PrivateKey.fromWIF(aliceWif)
    const bobKey = bsv.PrivateKey.fromWIF(bobWif)
    const issuerKey = bsv.PrivateKey.fromWIF(issuerWif)

    const bobPkh: Ripemd160 = hash160(bobKey.publicKey.toHex())
    const alicePkh: Ripemd160 = hash160(aliceKey.publicKey.toHex())
    const issuerPkh: Ripemd160 = hash160(issuerKey.publicKey.toHex())

    const bobSigner = new TestWallet(bobKey, new DummyProvider()) //create Bob's Wallet
    const issuingSigner = new TestWallet(issuerKey, new DummyProvider()) //create issuer Wallet

    //not something for PROD! Test only. Connecting both private keys into same wallet for redemption signing process.
    //in practive, Bob Signs, passes Txn to Issuer, then Issuer Signs.
    const redemptionSigner = new TestWallet(
        [bobKey, issuerKey],
        new DummyProvider()
    )

    before(async () => {
        await SptNft.compile()
    })

    it('should transfer a spt ', async () => {
        //initial nft creation
        //when creating at first, bob owns it, issuer can redeem
        //we don't need to sign this because we are not broadcasting it
        const issuingSpt = new SptNft(bobPkh, issuerPkh)
        await issuingSpt.connect(issuingSigner)

        //create a deployment Txn and spend change back to issuer
        const fundingUtxo = getDummyUTXO(10000)
        const deployTxn = await issuingSpt.buildDeployTransaction(
            [fundingUtxo],
            100,
            issuerKey.publicKey.toAddress()
        )

        // let signedTxn = await issuingSigner.signTransaction(deployTxn)
        // let issuerSigHex = Buffer.from(signedTxn.getSignature(0).toString()) //grab the signature for input[0]

        // console.log(signedTxn.getSignature(0).toString())
        // let issuerSig = bsv.crypto.Signature.fromTxFormat(issuerSigHex)
        // let issuerSig = Sig(signedTxn.getSignature(0).toString())

        // const newSpt = prevInstance.next()
        // newSpt.transfer(issuerSig, pubKey)

        //get the instance of the contract that belongs to Bob
        const bobSpt = issuingSpt.next()
        bobSpt.ownerPkh = bobPkh //explicitly update/mutate the next iteration of the Txn to set Bob as owner
        await bobSpt.connect(bobSigner)
        const bobPubKey = PubKey(bobKey.publicKey.toHex())

        //now bob transfers to alice from the deployment transaction
        const { tx: callTx, atInputIndex } = await bobSpt.methods.transfer(
            (signatureResponse: SignatureResponse[]) =>
                signatureResponse[0].sig,
            bobPubKey,
            {
                fromUTXO: utxoFromOutput(deployTxn, 0),
                changeAddress: bobKey.publicKey.toAddress(),
                next: {
                    instance: bobSpt,
                    balance: 100,
                },
            } as MethodCallOptions<SptNft>
        )

        const result = callTx.verifyScript(atInputIndex)
        expect(result.success, result.error).to.eq(true)
    })

    it('it should redeem an spt successfully', async () => {
        console.log("Bob's Address: " + bobKey.publicKey.toAddress().toString())
        console.log(
            "Issuer's Address: " + issuerKey.publicKey.toAddress().toString()
        )

        //initial nft creation
        //when creating at first, bob owns it, issuer can redeem
        //we don't need to sign this because we are not broadcasting it
        const issuingSpt = new SptNft(bobPkh, issuerPkh)
        await issuingSpt.connect(issuingSigner)

        //create a deployment Txn and spend change back to issuer
        const fundingUtxo = getDummyUTXO(10000) //FIXME: Bob's funding source should be the issuer. or ANYONE_CAN_PAY protocol?
        const deployTxn = await issuingSpt.buildDeployTransaction(
            [fundingUtxo],
            100,
            issuerKey.publicKey.toAddress()
        )

        //get the instance of the contract that belongs to Bob
        const bobSpt = issuingSpt.next()
        bobSpt.ownerPkh = bobPkh //explicitly update/mutate the next iteration of the Txn to set Bob as owner
        await bobSpt.connect(bobSigner)
        const bobPubKey = PubKey(bobKey.publicKey.toHex())

        //now bob immediately spends the token back to the issuer
        const bobSpending = async () => {
            const { tx: callTx, atInputIndex } = await bobSpt.methods.transfer(
                (signatureResponse: SignatureResponse[]) =>
                    signatureResponse[0].sig,
                bobPubKey,
                {
                    fromUTXO: utxoFromOutput(deployTxn, 0),
                    changeAddress: bobKey.publicKey.toAddress(),
                    next: {
                        instance: bobSpt,
                        balance: 100,
                    },
                } as MethodCallOptions<SptNft>
            )

            const result = callTx.verifyScript(atInputIndex)
            expect(result.success, result.error).to.eq(true)

            return callTx
        }

        const bobSpendingTxn = await bobSpending()

        //the issuer now spends the token back to themselves to claim the sats

        const redeemNft = async () => {
            const redemptionSpt = bobSpt.next()
            redemptionSpt.ownerPkh = bobPkh //token still belongs to Bob.
            await redemptionSpt.connect(redemptionSigner)
            const issuerPubKey = PubKey(issuerKey.publicKey.toHex())

            //grab the UTXO of the NFT belonging to Bob
            const bobNftUtxo = utxoFromOutput(bobSpendingTxn, 0)

            //get the redemption transaction
            const redemptionTxn = await redemptionSpt.buildDeployTransaction(
                [bobNftUtxo], //funding source is still a P2PKH, but Bob's UTXO is included in the set now
                100,
                bobKey.publicKey.toAddress()
            )

            /**
             * the following is a bit involved. Multiple signatures, in unlock script require some fancy footwork
             * between MethodCallOptions.pubKeyOrAddrToSign and a utility method called findSig()
             */
            const { tx: redemptionCallTx, atInputIndex } =
                await redemptionSpt.methods.redeem(
                    (signatureResponse) =>
                        findSig(
                            signatureResponse,
                            bobKey.publicKey,
                            SignatureHashType.SINGLE
                        ),
                    bobPubKey,
                    (signatureResponse) =>
                        findSig(
                            signatureResponse,
                            issuerKey.publicKey,
                            SignatureHashType.SINGLE
                        ),
                    issuerPubKey,
                    {
                        fromUTXO: utxoFromOutput(redemptionTxn, 0),
                        changeAddress: bobKey.publicKey.toAddress(),
                        pubKeyOrAddrToSign: [
                            {
                                pubKeyOrAddr: bobKey.publicKey,
                                sigHashType: SignatureHashType.SINGLE,
                            },
                            {
                                pubKeyOrAddr: issuerKey.publicKey,
                                sigHashType: SignatureHashType.SINGLE,
                            },
                        ],
                        next: {
                            instance: redemptionSpt,
                            balance: 100,
                        },
                    } as MethodCallOptions<SptNft>
                )
            const result = redemptionCallTx.verifyScript(atInputIndex)
            expect(result.success, result.error).to.eq(true)

            return redemptionCallTx
        }

        const redemptionTxn = await redeemNft()

        //assert that the redemption transaction's UTXO now belongs to the issuer
        expect(redemptionTxn.outputs[0].satoshis == 100)
        const redeemerScript = new SptNft(issuerPkh, issuerPkh)
            .getStateScript()
            .toString()
        expect(redemptionTxn.outputs[0].script.toHex() == redeemerScript)
    })

    /*
    it('should allow the issuer to pay for redemption cost', () => {
    })

    it('should allow the holder to fund their lateral token transfer using specifial owner-locked, fungible redemption-tokens', () => {})

    it('should not allow redemption without ownership', async () => {})

    it('should allow issuer to disable third-party transfer. I.e. immediate redemption only', async () => {})

    it('should not allow redemption by third party', () => {})

    it('should not allow transfer by unauthorised person', () => {})

     */
})
