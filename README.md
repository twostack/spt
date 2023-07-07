> **Warning**
> This token standard is under active development and not considered production-ready yet.

# SPT - Satoshi-Pegged Tokens

The Satoshi-Pegged Token uses the locked Satoshi value as the direct accounting method for the unit-accounting of a representative token (satoshis as the unit of account)
E.g. 1 FooToken == 1 Satoshi, or 1 BarToken == 10 Satoshis

The direct meaning of the token is encoded as OP_RETURN data, and this OP_RETURN data is locked into the token through the enforcement of OP_PUSH_TX restrictions.

## Fungible SPTs

A pegged token that allows one to

- split the locked value of the token
- reassign ownership of the split tokens.
- disallows modification of the token data

## Non-Fungible SPTs

A pegged token that features

- reassign ownership of the token
- disallows splitting of the locked value of the token
- disallows modification of the token data

# SPT++

## Appendable SPTs

Building on the notion of an SPT, the SPT++ standard requires/allows one to append data to the end of the token's Output Script. These token feature

- reassignable ownership of the token
- append-only operation on the data of the token
- disallows splitting of the value of the token

# Token Feature Table

| Feature                     | Fungible SPT | Non-Fungible SPT | SPT++             |
| --------------------------- | ------------ | ---------------- | ----------------- |
| split locked value          | yes          | no               | no                |
| allows modification of data | no           | no               | yes (append-only) |
| can reassign ownership      | yes          | optional         | yes               |

## Build

```sh
npm run build
```

## Testing Locally

```sh
npm run test
```

## Run Bitcoin Testnet Tests

```sh
npm run testnet
```
