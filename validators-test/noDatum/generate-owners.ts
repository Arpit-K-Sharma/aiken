import { MeshWallet } from "@meshsdk/core";
import fs from "node:fs";
import path from "node:path";

async function main() {
    for (let i = 1; i <= 3; i++) {
        const secretKey = MeshWallet.brew(true) as string;
        const wallet = new MeshWallet({
            networkId: 0,
            key: { type: "root", bech32: secretKey },
        });

        const addr = (await wallet.getUnusedAddresses())[0];
        const skFile = path.join(__dirname, `owner${i}.sk`);
        const addrFile = path.join(__dirname, `owner${i}.addr`);

        fs.writeFileSync(skFile, secretKey);
        fs.writeFileSync(addrFile, addr);

        console.log(`Owner ${i} address: ${addr}`);
        console.log(`Owner ${i} sk:      ${skFile}`);
    }
    console.log("\n✅ Done. Fund each address with test ADA before running lock.ts.");
    console.log("   Use the Cardano Preview faucet: https://docs.cardano.org/cardano-testnets/tools/faucet");
}

main();
