import { join } from 'node:path';
import { openDatabase } from '../../src/main/db/connection';
import { Store } from '../../src/main/db/store';
import { FileStore } from '../../src/main/storage/files';

export function openStore(dir: string): Store {
  const db = openDatabase(join(dir, 'atelier.db'));
  return new Store(db, new FileStore(join(dir, 'files')));
}
