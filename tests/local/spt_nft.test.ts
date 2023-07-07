import { expect, use } from 'chai'
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
import chaiAsPromised from 'chai-as-promised'
use(chaiAsPromised)

async function transferToken(
    recipientSpt: SptNft,
    recipientPubKey: PubKey,
    recipientKey: bsv.PrivateKey,
    tokenHoldingTx: bsv.Transaction
) {
    const { tx: callTx, atInputIndex } = await recipientSpt.methods.transfer(
        (signatureResponse: SignatureResponse[]) => signatureResponse[0].sig,
        recipientPubKey,
        {
            fromUTXO: utxoFromOutput(tokenHoldingTx, 0), //recipient spends from the issuing UTXO
            changeAddress: recipientKey.publicKey.toAddress(),
            next: {
                instance: recipientSpt,
                balance: 100,
            },
        } as MethodCallOptions<SptNft>
    )
    return { callTx, atInputIndex }
}

/***
 * Issues and transfers a token from Issuer to Recipient
 *
 * @param issuerPkh - issuer pubkey hash (hash160)
 * @param issuerKey - issuer private key
 * @param issuingSigner - Issuer's signing-wallet provider
 * @param recipientPkh - recipient pubkey hash (hash160)
 * @param recipientSigner - Recipient's signing-wallet provider
 * @param recipientKey - recipient private key
 */
async function issueAndTransferToken(
    issuerPkh: Ripemd160,
    issuerKey: bsv.PrivateKey,
    issuingSigner: TestWallet,
    recipientPkh: Ripemd160,
    recipientSigner: TestWallet,
    recipientKey: bsv.PrivateKey
) {
    //initial nft creation
    //when creating at first, recipient owns it, issuer can redeem
    //we don't need to sign this because we are not broadcasting it
    const issuingSpt = new SptNft(recipientPkh, issuerPkh)
    await issuingSpt.connect(issuingSigner)

    //create a deployment Txn and spend change back to issuer
    const fundingUtxo = getDummyUTXO(10000)
    const issuingTxn = await issuingSpt.buildDeployTransaction(
        [fundingUtxo],
        100, //lock 100 sats in the NFT
        issuerKey.publicKey.toAddress()
    )

    //get the instance of the contract that belongs to Recipient
    const recipientSpt = issuingSpt.next()
    recipientSpt.ownerPkh = recipientPkh //explicitly update/mutate the next iteration of the Txn to set Bob as owner
    await recipientSpt.connect(recipientSigner)
    const recipientPubKey = PubKey(recipientKey.publicKey.toHex())

    //now recipient transfers back to issuer from the deployment transaction
    const { callTx, atInputIndex } = await transferToken(
        recipientSpt,
        recipientPubKey,
        recipientKey,
        issuingTxn
    )

    return {
        tokenHoldingTx: callTx,
        atInputIndex,
        tokenHoldingSpt: recipientSpt,
    }
}

/***
 * Redeem the NFT by spending it from token holder back to the issuer. This would in practice
 * occur as two steps
 *       1. token owner signs and passes tx to issuer,
 *       2. issuer takes partially signed tx and signs as well.
 *
 * However for testing purposes we combine these keys into one wallet (DON'T DO THIS IN PROD )
 *
 * @param redemptionSigner - A signing wallet holding both private keys of issuer and token holder
 * @param issuerKey  - Private key of issuer
 * @param tokenHoldingSpt - A contract instance with current token ownership
 * @param tokenOwnerPkh - The token owner's pubkeyhash
 * @param tokenHoldingTx - The bsv.Transaction containing the token
 * @param tokenOwnerKey - The private key of the token owner
 */
async function redeemNft(
    redemptionSigner: TestWallet,
    issuerKey: bsv.PrivateKey,
    tokenHoldingSpt: SptNft,
    tokenOwnerPkh: Ripemd160,
    tokenHoldingTx: bsv.Transaction,
    tokenOwnerKey: bsv.PrivateKey
) {
    const redemptionSpt = tokenHoldingSpt.next()
    redemptionSpt.ownerPkh = tokenOwnerPkh //token still belongs to Bob.
    await redemptionSpt.connect(redemptionSigner)
    const issuerPubKey = PubKey(issuerKey.publicKey.toHex())

    //grab the UTXO of the NFT
    const ownerNftUtxo = utxoFromOutput(tokenHoldingTx, 0)

    //get the redemption transaction
    const redemptionTxn = await redemptionSpt.buildDeployTransaction(
        [ownerNftUtxo], //funding source is still a P2PKH, but Bob's UTXO is included in the set now
        100,
        tokenOwnerKey.publicKey.toAddress()
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
                    tokenOwnerKey.publicKey,
                    SignatureHashType.SINGLE
                ),
            PubKey(tokenOwnerKey.publicKey.toHex()),
            (signatureResponse) =>
                findSig(
                    signatureResponse,
                    issuerKey.publicKey,
                    SignatureHashType.SINGLE
                ),
            issuerPubKey,
            {
                fromUTXO: utxoFromOutput(redemptionTxn, 0),
                changeAddress: tokenOwnerKey.publicKey.toAddress(),
                pubKeyOrAddrToSign: [
                    {
                        pubKeyOrAddr: tokenOwnerKey.publicKey,
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

    it('should transfer an SPT ', async () => {
        const { tokenHoldingTx, atInputIndex } = await issueAndTransferToken(
            issuerPkh,
            issuerKey,
            issuingSigner,
            bobPkh,
            bobSigner,
            bobKey
        )

        const result = tokenHoldingTx.verifyScript(atInputIndex)
        expect(result.success, result.error).to.eq(true)
    })

    it('it should redeem an spt successfully', async () => {
        const { tokenHoldingTx, atInputIndex, tokenHoldingSpt } =
            await issueAndTransferToken(
                issuerPkh,
                issuerKey,
                issuingSigner,
                bobPkh,
                bobSigner,
                bobKey
            )

        const result = tokenHoldingTx.verifyScript(atInputIndex)
        expect(result.success, result.error).to.eq(true)

        //the issuer now spends the token back to themselves to claim the sats
        const redemptionTxn = await redeemNft(
            redemptionSigner,
            issuerKey,
            tokenHoldingSpt,
            bobPkh,
            tokenHoldingTx,
            bobKey
        )

        //assert that the redemption transaction's UTXO now belongs to the issuer
        expect(redemptionTxn.outputs[0].satoshis == 100)
        const redeemerScript = new SptNft(issuerPkh, issuerPkh)
            .getStateScript()
            .toString()
        expect(redemptionTxn.outputs[0].script.toHex() == redeemerScript)
    })

    it('should not allow transfer by unauthorised person', async () => {
        //issue a token to Bob
        const getBobsToken = async () => {
            const { tokenHoldingTx, atInputIndex, tokenHoldingSpt } =
                await issueAndTransferToken(
                    issuerPkh,
                    issuerKey,
                    issuingSigner,
                    bobPkh,
                    bobSigner,
                    bobKey
                )

            const result = tokenHoldingTx.verifyScript(atInputIndex)
            expect(result.success, result.error).to.eq(true)

            return { tokenHoldingTx, tokenHoldingSpt }
        }

        const { tokenHoldingTx, tokenHoldingSpt } = await getBobsToken()

        //alice attempts to transfer bob's token to herself
        return expect(
            transferToken(
                tokenHoldingSpt,
                PubKey(aliceKey.publicKey.toHex()),
                aliceKey,
                tokenHoldingTx
            )
        ).to.be.rejectedWith(/owner pubkeyhash does not match/)
    })

    it('should not allow redemption without ownership', async () => {
        const issueToken = async () => {
            const { tokenHoldingTx, atInputIndex, tokenHoldingSpt } =
                await issueAndTransferToken(
                    issuerPkh,
                    issuerKey,
                    issuingSigner,
                    bobPkh,
                    bobSigner,
                    bobKey
                )

            const result = tokenHoldingTx.verifyScript(atInputIndex)
            expect(result.success, result.error).to.eq(true)

            return { tokenHoldingTx, tokenHoldingSpt }
        }

        const { tokenHoldingTx, tokenHoldingSpt } = await issueToken()

        //bob own's the token. alice tries to redeem.
        const aliceSpt = new SptNft(alicePkh, issuerPkh)

        return expect(
            redeemNft(
                redemptionSigner,
                issuerKey,
                aliceSpt,
                alicePkh,
                tokenHoldingTx,
                aliceKey
            )
        ).to.be.rejectedWith(Error)
    })
    /*


    it('should not allow redemption by third party', () => {

    })


    /*
    it('should allow the issuer to pay for redemption cost', () => {
    })

    it('should allow the holder to fund their lateral token transfer using specifial owner-locked, fungible redemption-tokens', () => {})


    it('should allow issuer to disable third-party transfer. I.e. immediate redemption only', async () => {})


     */
})
