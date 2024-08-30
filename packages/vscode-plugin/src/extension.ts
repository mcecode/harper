import type { paths } from '@octokit/openapi-types';
import type { ReadableStream } from 'node:stream/web';
import type { ExtensionContext } from 'vscode';
import type { Executable, LanguageClientOptions } from 'vscode-languageclient/node';

import fs from 'node:fs/promises';
import path from 'node:path';
import stream from 'node:stream';
import util from 'node:util';
import { extract } from 'tar';
import { commands, window } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import yauzl from 'yauzl';

// TODO: Put this in a `harperContext` object along with other reusable structures and data, like:
// `binDir`
// Extension version
// Output channel
let client: LanguageClient | null = null;

const serverOptions: Executable = {
	// TODO: Pass the path of the downloaded `harper-ls` here
	command: 'harper-ls',
	transport: TransportKind.stdio
};
const clientOptions: LanguageClientOptions = {
	documentSelector: [
		{ language: 'html' },
		{ language: 'markdown' },
		{ language: 'rust' },
		{ language: 'typescriptreact' },
		{ language: 'typescript' },
		{ language: 'py' },
		{ language: 'javascript' },
		{ language: 'javascriptreact' },
		{ language: 'go' },
		{ language: 'c' },
		{ language: 'cpp' },
		{ language: 'ruby' },
		{ language: 'swift' },
		{ language: 'csharp' },
		{ language: 'toml' },
		{ language: 'lua' },
		{ language: 'sh' },
		{ language: 'java' }
	],
	outputChannel: window.createOutputChannel('Harper')
};

export async function activate(context: ExtensionContext): Promise<void> {
	if (!(await pathExists(path.join(context.extensionPath, 'bin')))) {
		try {
			await downloadLatestHarperLs(context);
		} catch (error) {
			// TODO: Inform the user of the error
		}
	}

	context.subscriptions.push(commands.registerCommand('harper-ls.restart', startLanguageServer));
	startLanguageServer();
}

async function downloadLatestHarperLs(context: ExtensionContext) {
	let arch = null;
	switch (process.arch) {
		case 'arm':
		case 'arm64': {
			arch = 'aarch64';
			break;
		}
		case 'x64': {
			arch = 'x86_64';
			break;
		}
	}
	if (!arch) {
		const sup = ['arm', 'x86_64'];
		throw new Error(`Unsupported arch '${process.arch}'. Supported: ${sup.join(', ')}`);
	}

	let platform = null;
	switch (process.platform) {
		case 'win32': {
			platform = 'pc-windows-gnu.zip';
			break;
		}
		case 'darwin': {
			platform = 'apple-darwin.tar.gz';
			break;
		}
		case 'linux': {
			platform = 'unknown-linux-gnu.tar.gz';
			break;
		}
	}
	if (!platform) {
		const sup = ['Windows', 'macOS', 'Linux'];
		throw new Error(`Unsupported platform '${process.platform}'. Supported: ${sup.join(', ')}`);
	}

	let assets;
	try {
		const res = await fetch('https://api.github.com/repos/elijah-potter/harper/releases/latest', {
			redirect: 'follow',
			headers: {
				Accept: 'application/vnd.github.v3+json',
				'User-Agent': 'harper-for-vs-code/0.0.1',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		});
		({ assets } =
			(await res.json()) as paths['/repos/{owner}/{repo}/releases/latest']['get']['responses']['200']['content']['application/json']);
	} catch {
		throw new Error('Failed to get info on latest harper-ls version');
	}

	const assetName = `harper-ls-${arch}-${platform}`;
	const asset = assets.find((asset) => asset.name === assetName);
	if (!asset) {
		throw new Error(
			`Asset name '${assetName}' not found in releases. ` +
				`Found: ${assets.map((asset) => asset.name).join(', ')}`
		);
	}

	const binDir = path.join(context.extensionPath, 'bin');
	if (!(await pathExists(binDir))) {
		try {
			await fs.mkdir(binDir, { recursive: true });
		} catch {
			throw new Error('Failed to create bin directory');
		}
	}

	const archiveFile = path.join(binDir, assetName);
	try {
		await fs.writeFile(
			archiveFile,
			stream.Readable.fromWeb((await fetch(asset.browser_download_url)).body as ReadableStream)
		);
	} catch {
		throw new Error('Failed to download harper-ls archive');
	}

	try {
		await unzip({ type: asset.content_type, archive: archiveFile, outDir: binDir });
	} catch (error) {
		throw new Error('Failed to extract harper-ls from archive');
	}

	// TODO: Cleanup archive file and note in a file current `harper-ls` version
}

async function startLanguageServer(): Promise<void> {
	if (client) {
		if (client.diagnostics) {
			client.diagnostics.clear();
		}

		try {
			await client.stop(2000);
		} catch (error) {
			// TODO: Inform the user of the error
		}
	}

	client = new LanguageClient('harper-ls', 'Harper', serverOptions, clientOptions);

	try {
		await client.start();
	} catch (error) {
		// TODO: Inform the user of the error
		client = null;
	}
}

type UnzipArgs = { type: string; archive: string; outDir: string };
async function unzip({ type, archive, outDir }: UnzipArgs): Promise<void> {
	if (type === 'application/gzip') {
		await extract({ file: archive, cwd: outDir });
		return;
	}

	if (type === 'application/zip') {
		const zip = await util.promisify(yauzl.open)(archive);
		const openReadStream = util.promisify(zip.openReadStream.bind(zip));

		// `.once` since we're sure the archive only contains `harper-ls.exe`.
		zip.once('entry', async (entry) => {
			(await openReadStream(entry)).pipe(
				(await fs.open(path.join(outDir, entry.fileName), 'w')).createWriteStream()
			);
		});

		return;
	}

	const sup = ['application/gzip', 'application/zip'];
	throw new Error(`Unsupported type '${type}'. Suppoted: ${sup.join(', ')}`);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

export function deactivate(): Thenable<void> | void {
	if (!client) {
		return;
	}

	return client.stop();
}
