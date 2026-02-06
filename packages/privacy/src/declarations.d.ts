declare module 'tweetnacl' {
  export interface BoxKeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }
  export const box: {
    keyPair: () => BoxKeyPair;
    (msg: Uint8Array, nonce: Uint8Array, theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array;
    open: (box: Uint8Array, nonce: Uint8Array, theirPublicKey: Uint8Array, mySecretKey: Uint8Array) => Uint8Array | null;
    before: (theirPublicKey: Uint8Array, mySecretKey: Uint8Array) => Uint8Array;
    nonceLength: number;
    publicKeyLength: number;
    secretKeyLength: number;
  };
  export const sign: {
    keyPair: () => { publicKey: Uint8Array; secretKey: Uint8Array };
    (msg: Uint8Array, secretKey: Uint8Array): Uint8Array;
    detached: (msg: Uint8Array, secretKey: Uint8Array) => Uint8Array;
    open: (signedMsg: Uint8Array, publicKey: Uint8Array) => Uint8Array | null;
    detached_verify: (msg: Uint8Array, sig: Uint8Array, publicKey: Uint8Array) => boolean;
  };
  export const randomBytes: (n: number) => Uint8Array;
  export const hash: (msg: Uint8Array) => Uint8Array;
}
declare module 'bs58';
declare module 'snarkjs';
