import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/** 对密码进行 bcrypt 哈希 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/** 验证明文密码是否与哈希匹配 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
