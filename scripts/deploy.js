const { ethers } = require('ethers');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromBase64 } = require('@mysten/sui/utils');
const fs = require('fs');
const artifact = require('../artifacts/contracts/Lock.sol/Lock.json');

async function main() {
	const provider = new ethers.JsonRpcProvider('https://1rpc.io/holesky');
	const ethWallet = new ethers.Wallet(process.env.PRIVATE_KEY_ETH, provider);
	const suiKeypair = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY_SUI);

	const network = await provider.getNetwork();

	console.log('1. ETH WALLET ==================================');
	console.log('NETWORK', network.name);
	console.log('ADDRESS', ethWallet.address);
	console.log('BALANCE', ethers.formatEther((await provider.getBalance(ethWallet.address))));
	console.log('');

	console.log('2. SUI WALLET ==================================');
	console.log('ADDRESS', suiKeypair.toSuiAddress());
	console.log('');

	const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, ethWallet);

	const bytecode = ethers.getBytes(artifact.bytecode);
	const { signature: sig1 } = await suiKeypair.signPersonalMessage(bytecode);

	const sig2 = await ethWallet.signMessage(fromBase64(sig1));

	// console.log(await suiKeypair.getPublicKey().verifyPersonalMessage(bytecode, sig1));
	// console.log(ethers.verifyMessage(fromBase64(sig1), sig2) === ethWallet.address);

	console.log('Deploying contract...');

	const contract = await factory.deploy('1000000000000000000');
	const tx = await contract.deploymentTransaction().wait();

	console.log('write proof to mvr.proof.json');

	if (!tx.contractAddress) {
		throw new Error('Contract address is not available in the transaction receipt.');
	}

	fs.writeFileSync(
		'./mvr.proof.json',
		JSON.stringify({
			mvr: {
				publicKey: suiKeypair.getPublicKey().toSuiPublicKey(),
				signature: sig1,
			},
			network: {
				chain: `eth::${ethers.toBeHex(network.chainId)}`,
				txHash: tx.hash,
				signature: sig2,
				contractAddress: tx.contractAddress,
			},
		})
	);
}

main();