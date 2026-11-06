// T6011: SQLite's inverted FTS5 index and BM25. No note text or index is written outside the vault.
import { Database } from "bun:sqlite";
import { fold } from "../store/text.ts";
import { lexicalForms, lexicalWords } from "../shared/lexical.ts";
interface SearchDocument {
  meta: {
    path: string;
    title: string;
    version: string;
  };
  aliases: string[];
  content: string;
}
interface Row {
  path: string;
  rank: number;
}
const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
function fields(text: string, cache: Map<string, string[]>) {
  const words = lexicalWords(text);
  return [words.map(fold).join(" "), words.flatMap(word => { let forms = cache.get(word); if (!forms) {
      forms = lexicalForms(word);
      cache.set(word, forms);
    } return forms; }).join(" ")];
}
/** Query text never becomes SQL or an FTS operator. All terms are quoted and SQL parameters are bound. */
export function lexicalQuery(words: readonly string[], phrases: readonly string[]): string {
  return [...words, ...phrases].flatMap(lexicalWords).map(word => {
    const plain = fold(word), prefix = word.length >= 2 && !/^\d+$/.test(word) ? "*" : "";
    const stems = lexicalForms(word).map(s => `{stem_title stem_aliases stem_body}: ${quote(s)}`);
    return `({title aliases body}: ${quote(plain)}${prefix} OR ${stems.join(" OR ")})`;
  }).join(" AND ");
}
export class NoteSearchIndex {
  private readonly db = new Database(":memory:");
  private known = new Map<string, {
    id: number;
    version: string;
  }>();
  private serial = 0;
  /** Counter for verifying that unchanged cache entries do not get retokenized. */
  updates = 0;
  constructor() {
    this.db.exec("PRAGMA temp_store=MEMORY; CREATE VIRTUAL TABLE notes USING fts5(path UNINDEXED, title, aliases, body, stem_title, stem_aliases, stem_body, tokenize='unicode61 remove_diacritics 2')");
  }
  sync(documents: Iterable<SearchDocument>): void {
    const insert = this.db.query("INSERT INTO notes(rowid,path,title,aliases,body,stem_title,stem_aliases,stem_body) VALUES (?,?,?,?,?,?,?,?)");
    const remove = this.db.query("DELETE FROM notes WHERE rowid=?");
    const present = new Set<string>();
    const cache = new Map<string, string[]>();
    const next = new Map(this.known);
    let updates = 0;
    this.db.transaction(() => {
      for (const e of documents) {
        const path = e.meta.path, version = JSON.stringify([e.meta.version, e.meta.title, e.aliases]);
        present.add(path);
        const old = this.known.get(path);
        if (old?.version === version)
          continue;
        const [title, stemTitle] = fields(e.meta.title, cache), [aliases, stemAliases] = fields(e.aliases.join(" "), cache), [body, stemBody] = fields(e.content, cache);
        if (old)
          remove.run(old.id);
        const id = old?.id ?? ++this.serial;
        insert.run(id, path, title!, aliases!, body!, stemTitle!, stemAliases!, stemBody!);
        next.set(path, { id, version });
        updates++;
      }
      for (const [path, old] of this.known)
        if (!present.has(path)) {
          remove.run(old.id);
          next.delete(path);
        }
    })();
    this.known = next;
    this.updates += updates;
  }
  search(words: readonly string[], phrases: readonly string[]): {
    path: string;
    score: number;
  }[] {
    const query = lexicalQuery(words, phrases);
    if (!query)
      return [];
    // FTS5 returns the best BM25 as the most negative value. Keep the app's higher-is-better convention.
    return (this.db.query("SELECT path, bm25(notes,0,10,5,1,6,3,0.6) AS rank FROM notes WHERE notes MATCH ? ORDER BY rank,path").all(query) as Row[])
      .map(row => ({ path: row.path, score: -row.rank }));
  }
  close(): void { this.db.close(); this.known.clear(); }
}
