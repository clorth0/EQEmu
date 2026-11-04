import mysql, { type ResultSetHeader } from "mysql2/promise";

let pool: mysql.Pool | null = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "peq",
      password: process.env.DB_PASS || "peqpass",
      database: process.env.DB_NAME || "peq",
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return pool;
}

export async function query<T = unknown>(sql: string, params?: (string | number | null)[]): Promise<T[]> {
  const pool = getPool();
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function queryOne<T = unknown>(sql: string, params?: (string | number | null)[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

export async function execute(sql: string, params?: (string | number | null)[]): Promise<ResultSetHeader> {
  const pool = getPool();
  const [result] = await pool.execute<ResultSetHeader>(sql, params);
  return result;
}
