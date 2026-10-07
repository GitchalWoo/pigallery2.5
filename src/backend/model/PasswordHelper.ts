import * as bcrypt from 'bcrypt';

export class PasswordHelper {
  public static cryptPassword(password: string): string {
    const salt = bcrypt.genSaltSync(9);
    return bcrypt.hashSync(password, salt);
  }

  public static async cryptPasswordAsync(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(9);
    return await bcrypt.hash(password, salt);
  }

  public static async comparePasswordAsync(
    password: string,
    encryptedPassword: string
  ): Promise<boolean> {
    try {
      return await bcrypt.compare(password, encryptedPassword);
    } catch {
      return false;
    }
  }

  public static comparePassword(
      password: string,
      encryptedPassword: string
  ): boolean {
    try {
      return bcrypt.compareSync(password, encryptedPassword);
      // eslint-disable-next-line no-empty
    } catch (e) {
    }
    return false;
  }
}
