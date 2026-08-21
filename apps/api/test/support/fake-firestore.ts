// Fausse implémentation minimale de Firestore (multi-collection, requêtes where/limit,
// transactions) pour piloter des tests e2e (HTTP réel via supertest) sans dépendre d'un
// émulateur Firestore ni de vraies credentials Firebase. Ne modélise que ce dont les
// services de Phase 0+1 ont besoin : doc()/get()/set()/update(), where()/limit()/get(),
// et runTransaction() en lecture-modification-écriture simple (pas de retry sur conflit :
// les specs e2e ne testent pas la concurrence, déjà couverte au niveau unitaire dans
// analytics.service.spec.ts).

export type DocData = Record<string, unknown>;

type Filter = [field: string, op: '==' | 'in', value: unknown];

interface StoredDoc {
  data: DocData;
}

// Firestore résout `where('a.b', ...)` par rapport au champ imbriqué `a.b`, pas à une clé
// littérale `"a.b"` sur le document — cette fake doit se comporter pareil.
function getByPath(data: DocData, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as DocData)[key];
  }, data);
}

function matches(value: unknown, op: Filter[1], target: unknown): boolean {
  if (op === '==') return value === target;
  return Array.isArray(target) && target.includes(value);
}

export class FakeFirestoreDb {
  private readonly collections = new Map<string, Map<string, StoredDoc>>();

  seed(collection: string, id: string, data: DocData): void {
    this.storeFor(collection).set(id, { data });
  }

  getRaw(collection: string, id: string): DocData | undefined {
    return this.storeFor(collection).get(id)?.data;
  }

  collection(name: string) {
    return this.collectionRef(name, []);
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx: FakeTransaction = {
      get: async (ref: FakeDocRef) => ref.get(),
      set: (ref: FakeDocRef, value: DocData) => {
        void ref.set(value);
      },
      update: (ref: FakeDocRef, patch: DocData) => {
        void ref.update(patch);
      },
    };
    return fn(tx);
  }

  private storeFor(name: string): Map<string, StoredDoc> {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name)!;
  }

  private collectionRef(name: string, filters: Filter[]): FakeCollectionRef {
    const store = () => this.storeFor(name);

    const runQuery = (limit?: number) => {
      const entries = [...store().entries()].filter(([, entry]) =>
        filters.every(([field, op, value]) => matches(getByPath(entry.data, field), op, value)),
      );
      const limited = limit ? entries.slice(0, limit) : entries;
      return {
        empty: limited.length === 0,
        docs: limited.map(([id, entry]) => ({
          id,
          data: () => entry.data,
          ref: this.docRef(name, id),
        })),
      };
    };

    return {
      doc: (id: string) => this.docRef(name, id),
      where: (field: string, op: Filter[1], value: unknown) =>
        this.collectionRef(name, [...filters, [field, op, value]]),
      limit: (n: number) => ({ get: () => Promise.resolve(runQuery(n)) }),
      get: () => Promise.resolve(runQuery()),
    };
  }

  private docRef(name: string, id: string): FakeDocRef {
    const store = () => this.storeFor(name);
    return {
      id,
      get: () => {
        const entry = store().get(id);
        return Promise.resolve({ exists: entry !== undefined, data: () => entry?.data, id });
      },
      update: (patch: DocData) => {
        const entry = store().get(id);
        if (!entry) throw new Error(`FakeFirestoreDb: doc ${name}/${id} introuvable (update)`);
        store().set(id, { data: { ...entry.data, ...patch } });
        return Promise.resolve();
      },
      set: (value: DocData) => {
        store().set(id, { data: value });
        return Promise.resolve();
      },
    };
  }
}

export interface FakeDocRef {
  id: string;
  get: () => Promise<{ exists: boolean; data: () => DocData | undefined; id: string }>;
  update: (patch: DocData) => Promise<void>;
  set: (value: DocData) => Promise<void>;
}

interface FakeCollectionRef {
  doc: (id: string) => FakeDocRef;
  where: (field: string, op: Filter[1], value: unknown) => FakeCollectionRef;
  limit: (n: number) => { get: () => Promise<FakeQuerySnapshot> };
  get: () => Promise<FakeQuerySnapshot>;
}

interface FakeQuerySnapshot {
  empty: boolean;
  docs: Array<{ id: string; data: () => DocData; ref: FakeDocRef }>;
}

interface FakeTransaction {
  get: (
    ref: FakeDocRef,
  ) => Promise<{ exists: boolean; data: () => DocData | undefined; id: string }>;
  set: (ref: FakeDocRef, value: DocData) => void;
  update: (ref: FakeDocRef, patch: DocData) => void;
}
