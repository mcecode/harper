import type { Executable, LanguageClientOptions } from 'vscode-languageclient/node';
import type { ExtensionContext } from 'vscode';

import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import { commands } from 'vscode';

let client: LanguageClient | null = null;

const serverOptions: Executable = {
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
	]
};

export function activate(context: ExtensionContext): void {
	context.subscriptions.push(commands.registerCommand('harper-ls.restart', startLanguageServer));
	startLanguageServer();
}

async function startLanguageServer(): Promise<void> {
	if (client) {
		if (client.diagnostics) {
			client.diagnostics.clear();
		}

		try {
			await client.stop(2000);
		} catch (error) {
			// TODO: Log this out to the user
		}
	}

	client = new LanguageClient('harper-ls', 'Harper', serverOptions, clientOptions);

	try {
		await client.start();
	} catch (error) {
		// TODO: Log this out to the user
		client = null;
	}
}

export function deactivate(): Thenable<void> | void {
	if (!client) {
		return;
	}

	return client.stop();
}
