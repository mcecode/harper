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

let client: LanguageClient | null = null;

// TODO: Add `client`, extension version, output channel
const harperContext = { binDir: '' };
const serverOptions: Executable = { command: '', transport: TransportKind.stdio };
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
	harperContext.binDir = path.join(context.extensionPath, 'bin');
	serverOptions.command = path.join(
		harperContext.binDir,
		`harper-ls${process.platform === 'win32' ? '.exe' : ''}`
	);

	context.subscriptions.push(commands.registerCommand('harper-ls.restart', startLanguageServer));

	if (!(await pathExists(path.join(context.extensionPath, 'bin')))) {
		try {
			// TODO: Open Harper output and log the download progress to the user
			await downloadLatestHarperLs();
		} catch (error) {
			// TODO: Inform the user of the error
		}
	}

	startLanguageServer();
}

async function downloadLatestHarperLs() {
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

	let assets, version;
	try {
		const res = await fetch('https://api.github.com/repos/elijah-potter/harper/releases/latest', {
			redirect: 'follow',
			headers: {
				Accept: 'application/vnd.github.v3+json',
				'User-Agent': 'harper-for-vs-code/0.0.1',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		});
		({ assets, tag_name: version } =
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

	if (!(await pathExists(harperContext.binDir))) {
		try {
			await fs.mkdir(harperContext.binDir, { recursive: true });
		} catch {
			throw new Error('Failed to create bin directory');
		}
	}

	const archiveFile = path.join(harperContext.binDir, assetName);
	try {
		await fs.writeFile(
			archiveFile,
			stream.Readable.fromWeb((await fetch(asset.browser_download_url)).body as ReadableStream)
		);
	} catch {
		throw new Error('Failed to download harper-ls archive');
	}

	const currentHarperLs = path.join(
		harperContext.binDir,
		`harper-ls${process.platform === 'win32' ? '.exe' : ''}`
	);
	const oldHarperLs = currentHarperLs + '.old';
	if (await pathExists(currentHarperLs)) {
		try {
			await fs.rename(currentHarperLs, oldHarperLs);
			await updateMetadata({ oldVersion: (await getMetadata()).currentVersion });
		} catch {
			throw new Error('Failed to backup old harper-ls version');
		}
	}

	try {
		await unzip({ type: asset.content_type, archive: archiveFile, outDir: harperContext.binDir });
	} catch {
		throw new Error('Failed to extract harper-ls from archive');
	}

	try {
		await updateMetadata({ currentVersion: version });
	} catch {
		throw new Error('Failed to update metadata');
	}

	try {
		await fs.rm(archiveFile);
	} catch {
		throw new Error('Failed to delete harper-ls archive');
	}
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

type Metadata = { oldVersion?: string; currentVersion?: string };
const metadataFile = path.join(harperContext.binDir, 'metadata.json');
async function getMetadata(): Promise<Metadata> {
	try {
		return JSON.parse(await fs.readFile(metadataFile, 'utf-8'));
	} catch {
		throw new Error('Failed to read metadata.json');
	}
}
async function updateMetadata(newData: Metadata): Promise<void> {
	let metadata;
	if (await pathExists(metadataFile)) {
		try {
			metadata = JSON.parse(await fs.readFile(metadataFile, 'utf-8'));
		} catch {
			throw new Error('Failed to read metadata.json');
		}
	}

	try {
		await fs.writeFile(metadataFile, JSON.stringify(Object.assign(metadata, newData), null, 2));
	} catch {
		throw new Error('Failed to write metadata.json');
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
