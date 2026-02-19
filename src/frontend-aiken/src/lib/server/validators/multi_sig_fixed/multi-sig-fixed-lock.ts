import { Asset, UTxO } from "@meshsdk/core";
import type { BrowserWallet } from "@meshsdk/core";
import { getTxBuilder } from "../../script-builder";
import { addressToKeyHash, getCSL } from "@/lib/addressToKeyHash";
import { getCacheSignal } from "next/dist/server/app-render/work-unit-async-storage.external";

await getCSL();

export async function buildLockFixedTransaction(
    scriptAddr: string,
    ownerAddr: string,
    assets: Asset[],
    walletUtxos: UTxO[]
){
    const ownerHash = await addressToKeyHash(ownerAddr);

    const txBuilder = getTxBuilder();
    
    const unsignedTx = await txBuilder
    .txOut(scriptAddr, assets)
    .changeAddress(ownerAddr)
    .selectUtxosFrom(walletUtxos)
    .complete();

    return unsignedTx;


}



export async function lockAssetsToMultiSigFixed(
    wallet: BrowserWallet,
    scriptAddr: string,
    ownerAddr: string,
    assets: Asset[]
){
    const walletUtxos = await wallet.getUtxos();
    

    const unsignedTx = await buildLockFixedTransaction(scriptAddr, ownerAddr, assets, walletUtxos);

    const signetTx = await wallet.signTx(unsignedTx);

    const txHash = await wallet.submitTx(signetTx);

    return txHash;

}