declare module "better-sqlite3" {
  type Statement = {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };

  class Database {
    constructor(path: string, options?: { readonly?: boolean });
    prepare(sql: string): Statement;
  }

  namespace Database {
    export { Database };
  }

  export default Database;
}
