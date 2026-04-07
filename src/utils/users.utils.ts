import { PoolConnection } from "mysql2/promise";
import { conn } from "../config/connect_db.js";

export async function getUsers(conn: PoolConnection) {
  try {
    const [users] = await conn.query("");
    if (users) {
    }
  } catch (err: any) {}
  return [];
}

export async function getUser(id?: number, email?: string) {
  if (!id && !email) return [];
  try {
    const [users] = await conn.query("");
    if (!users) return []
  } catch (err: any) {
    throw Error(err)
  }
  return [];
}
