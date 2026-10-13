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

type RowSchema = V.StrictObjectSchema<v.ObjectEntries, V.ErrorMessage<V.StrictObjectIssue> | undefined>;
type RunArgs = Parameters<DuckDBConnection["runAndReadAll"]>;

export async function query<S extends RowSchema>(
  rowSchema: S,
  conn: DuckDBConnection,
  ...[sql, values]: RunArgs
) {
  const reader = await conn.runAndReadAll(sql, values);
  return v.parse(v.array(rowSchema), reader.getRowObjectsJS());
}

export async function queryRow<S extends RowSchema>(
  rowSchema: S,
  conn: DuckDBConnection,
  ...[sql, values]: RunArgs
) {
  const reader = await conn.runAndReadAll(sql, values);
  return v.parse(v.strictTuple([rowSchema]), reader.getRowObjectsJS())[0];
}

export async function queryColumn<S extends V.GenericSchema>(
  valueSchema: S,
  conn: DuckDBConnection,
  ...[sql, values]: RunArgs
) {
  const reader = await conn.runAndReadAll(sql, values);
  // getColumnsJS() returns an empty array if the result is empty.
  const columns = Object.values(reader.getColumnsObjectJS());
  return v.parse(v.strictTuple([v.array(valueSchema)]), columns)[0];
}

export async function readParquetKvMetadata<S extends V.GenericSchema>(
  path: string,
  key: string,
  valueSchema: S
) {
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