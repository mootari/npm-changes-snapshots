import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import * as v from "valibot";
import type * as V from "valibot";

export async function withMemoryDb<T>(run: (conn: DuckDBConnection) => Promise<T>) {
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  try {
    return await run(conn);
  }
  finally {
    conn.closeSync();
    db.closeSync();
  }
}

export async function query<
  C extends DuckDBConnection,
  E extends V.ObjectEntries,
  M extends V.ErrorMessage<V.StrictObjectIssue> | undefined,
  S extends V.StrictObjectSchema<E, M>
>(rowSchema: S, conn: C, ...[sql, values]: Parameters<C["runAndReadAll"]>) {
  const reader = await conn.runAndReadAll(sql, values);
  return v.parse(v.array(rowSchema), reader.getRowObjectsJS());
}

export async function queryRow<
  C extends DuckDBConnection,
  E extends V.ObjectEntries,
  M extends V.ErrorMessage<V.StrictObjectIssue> | undefined,
  S extends V.StrictObjectSchema<E, M>
>(rowSchema: S, conn: C, ...[sql, values]: Parameters<C["runAndReadAll"]>) {
  const reader = await conn.runAndReadAll(sql, values);
  return v.parse(v.strictTuple([rowSchema]), reader.getRowObjectsJS())[0];
}

export async function queryColumn<
  C extends DuckDBConnection,
  I,
  O,
  M extends V.BaseIssue<unknown>,
  S extends V.BaseSchema<I, O, M>
>(valueSchema: S, conn: C, ...[sql, values]: Parameters<C["runAndReadAll"]>) {
  const reader = await conn.runAndReadAll(sql, values);
  // getColumnsJS() returns an empty array if the result is empty.
  const columns = Object.values(reader.getColumnsObjectJS());
  return v.parse(v.strictTuple([v.array(valueSchema)]), columns)[0];
}

export async function readParquetKvMetadata<
  I,
  O,
  M extends V.BaseIssue<unknown>,
  S extends V.BaseSchema<I, O, M>
>(path: string, key: string, valueSchema: S) {
  return await withMemoryDb(async(conn) => {
    const rowSchema = v.strictObject({
      value: v.pipe(v.string(), v.parseJson(), valueSchema)
    });
    const {value} = await queryRow(
      rowSchema,
      conn,
      `
        SELECT decode(value) AS value
        FROM parquet_kv_metadata($path)
        WHERE key = $key
      `,
      {path, key}
    );
    return value;
  });

}