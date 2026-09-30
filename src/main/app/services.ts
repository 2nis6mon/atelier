import { safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { openDatabase } from '../db/connection';
import { Store } from '../db/store';
import { ChatGptAuth } from '../ai/chatgptAuth';
import { ProviderRegistry } from '../ai/registry';
import { EncryptedFileSecretStore, type SecretStore } from '../ai/secrets';
import { AiService } from '../ai/service';
import { ExportService, type PdfRenderer } from '../export/service';
import { ImportService } from '../import/service';
import { FileStore } from '../storage/files';

export interface Services {
  store: Store;
  importer: ImportService;
  secrets: SecretStore;
  chatgpt: ChatGptAuth;
  registry: ProviderRegistry;
  ai: AiService;
  exporter: ExportService;
}

/** Opens the data directory: <root>/data holds the database and files; secrets live outside it. */
export function openServices(root: string, renderPdf: PdfRenderer, secrets?: SecretStore): Services {
  const dataDir = join(root, 'data');
  const store = new Store(openDatabase(join(dataDir, 'atelier.db')), new FileStore(join(dataDir, 'files')));
  const secretStore = secrets ?? new EncryptedFileSecretStore(join(root, 'secrets.json'), safeStorage);
  const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);
  const chatgpt = new ChatGptAuth({ fetch: fetchFn, secrets: secretStore, openExternal: (url) => shell.openExternal(url), appName: 'Atelier' });
  const registry = new ProviderRegistry({ secrets: secretStore, fetch: fetchFn, settings: () => store.getSettings(), chatgpt });
  return {
    store,
    importer: new ImportService(store),
    secrets: secretStore,
    chatgpt,
    registry,
    ai: new AiService(store, registry),
    exporter: new ExportService(store, renderPdf),
  };
}
