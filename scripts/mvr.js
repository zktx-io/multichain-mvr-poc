const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');
const { toBase64 } = require('@mysten/sui/utils');
const fs = require('fs');

function loadProvenance() {
	const data = fs.readFileSync('./mvr.intoto.jsonl', 'utf-8');
	return toBase64(new TextEncoder().encode(data));
};

function loadProof() {
	const data = fs.readFileSync('./mvr.proof.json', 'utf-8');
	return JSON.parse(data);
}

const registerPublicNameApp = (name, tx, appsRegistryId) => {
	const publicNameObjectId = '0xa7427dd0bde7fc61856a9955e52f855451ea3d01f96cc042cfacd80bd76af0c3';
	const target = '0xbd73f4a4dd8348947e8fe942866d8d1e8b3cae25b2099743e69ddb5391acbe19'; // @mvr/public-names
	const appCap = tx.moveCall({
		target: `${target}::public_names::create_app`,
		arguments: [
			tx.object(publicNameObjectId),
			tx.object(appsRegistryId),
			tx.pure.string(name),
			tx.object.clock(),
		],
	});

	return appCap;
};

const setAllMetadata = (target, registry, appCap, config, tx_digest, provenance) => {
	const splitBase64ByByteLength = (base64, maxBytes = 16380) => {
		const encoder = new TextEncoder();
		const bytes = encoder.encode(base64);
		const chunks = [];

		for (let i = 0; i < bytes.length; i += maxBytes) {
			const slice = bytes.slice(i, i + maxBytes);
			chunks.push(new TextDecoder().decode(slice));
		}

		return chunks;
	};

	const chunks = splitBase64ByByteLength(provenance, 16380);
	const keys = [
		['description', config.app_desc],
		['homepage_url', config.homepage_url ?? (process.env.GIT_REPO || '')],
		[
			'documentation_url',
			config.documentation_url ?? (process.env.GIT_REPO ? `${process.env.GIT_REPO}#readme` : ''),
		],
		['icon_url', config.icon_url || ''],
		['contact', config.contact || ''],
		['tx_digest', tx_digest],
		...chunks.map((chunk, i) => [`provenance_${i}`, chunk]),
	];

	return (transaction) => {
		for (const [key, value] of keys) {
			transaction.moveCall({
				target,
				arguments: [registry, appCap, transaction.pure.string(key), transaction.pure.string(value)],
			});
		}
	};
};

async function main() {
	const suiKeypair = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY_SUI);
	const proof = loadProof();
	const provenance = loadProvenance();
    
	console.log('1. SUI WALLET ==================================');
	console.log('ADDRESS', suiKeypair.toSuiAddress());
	console.log('');


	const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
	const transaction = new Transaction();
	transaction.setSender(suiKeypair.toSuiAddress());

	// Attaching a non-Mainnet package to an application
	const mvrCore = '0xbb97fa5af2504cc944a8df78dcb5c8b72c3673ca4ba8e4969a98188bf745ee54';
	const appsRegistryId = '0x0e5d473a055b6b7d014af557a13ad9075157fdc19b6d51562a18511afd397727';
	const appCap = registerPublicNameApp('hello-evm', transaction, appsRegistryId);

	const appInfo = transaction.moveCall({
		target: `${mvrCore}::app_info::new`,
		arguments: [
			// transaction.pure.option("address", '<The objectId of the `PackageInfo` object on the external network>'),
			transaction.pure.option('address', proof.network.txHash),
			// transaction.pure.option("address", '<The address of the package on the external network>'),
			transaction.pure.option('address', proof.network.contractAddress),
			// transaction.pure.option("address", null),
			transaction.pure.option('address', null),
		],
	});

	transaction.moveCall({
		target: `${mvrCore}::move_registry::set_network`,
		arguments: [
			transaction.object(appsRegistryId),
			appCap,
			transaction.pure.string(proof.network.chain),
			appInfo,
		],
	});

	const recipient = transaction.moveCall({
		target: '0x2::tx_context::sender',
	});

	transaction.moveCall({
		target: `${mvrCore}::move_registry::set_metadata`,
		arguments: [transaction.object(appsRegistryId), appCap, transaction.pure.string('key'), transaction.pure.string('value')],
	});

	// Creating a new PackageInfo object
	transaction.add(
		setAllMetadata(
			`${mvrCore}::move_registry::set_metadata`,
			transaction.object(appsRegistryId),
			appCap,
			{
				app_desc: 'A simple Ethereum application',
				publicKey: proof.mvr.publicKey,
				sig1: proof.mvr.signature, // suiKeypair.signPersonalMessage(bytecode);
				sig2: proof.network.signature, // ethWallet.signMessage(fromBase64(sig1));
			},
			proof.network.txHash,
			provenance,
		),
	);

	/*
	// Adding source code information
	const mvrMetaData = '0x0f6b71233780a3f362137b44ac219290f4fd34eb81e0cb62ddf4bb38d1f9a3a1';

	const version = 0;
	const packageInfo = transaction.moveCall({
		target: `${mvrMetaData}::package_info::new`,
		arguments: [transaction.object(deploy.upgrade_cap)],
	});
	const git = transaction.moveCall({
		target: `${mvrMetaData}::git::new`,
		arguments: [
			transaction.pure.string(process.env.GIT_REPO ?? ''),
			transaction.pure.string(process.env.GIT_SUBDIR ?? ''),
			transaction.pure.string(process.env.GIT_COMMIT ?? ''),
		],
	});
	transaction.moveCall({
		target: `${mvrMetaData}::package_info::set_git_versioning`,
		arguments: [packageInfo, transaction.pure.u64(version), git],
	});

	transaction.moveCall({
		target: `${mvrMetaData}::package_info::transfer`,
		arguments: [transaction.object(packageInfo), recipient],
	});
	*/

	transaction.transferObjects([appCap], recipient);

	const { input } = await client.dryRunTransactionBlock({
		transactionBlock: await transaction.build({ client }),
	});
	transaction.setGasBudget(parseInt(input.gasData.budget));

	const { digest } = await client.signAndExecuteTransaction({
		transaction,
		signer: suiKeypair,	
	});
	const result = await client.waitForTransaction({ digest });
	console.log('Transaction Result:', result);
}

main();