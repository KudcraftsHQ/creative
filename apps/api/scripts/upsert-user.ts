/**
 * Create an account, or reset the password on one.
 *
 * Public signup is closed on the deployed instance, so this is how an account is
 * provisioned. It writes the rows itself rather than calling `auth.api.signUpEmail`
 * — that endpoint is exactly what `disableSignUp` turns off, so a script built on
 * it stops working the moment signup is closed, which is the moment it is needed.
 *
 * The one thing it does not hand-roll is the hash: that comes from better-auth's
 * own hasher, because an account with a hash in the wrong format exists and
 * cannot sign in.
 *
 *   bun run apps/api/scripts/upsert-user.ts <email> <password> [name]
 *
 * Inside the container:
 *   cd /app && bun apps/api/scripts/upsert-user.ts you@example.com 'secret' 'Your Name'
 */
import { auth } from "../src/lib/auth.ts";
import { prisma } from "../src/lib/prisma.ts";

const [email, password, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ") || email?.split("@")[0];

if (!email || !password) {
  console.error("usage: upsert-user.ts <email> <password> [name]");
  process.exit(1);
}

const ctx = await auth.$context;
const hash = await ctx.password.hash(password);

const user = await prisma.user.upsert({
  where: { email },
  update: { name: name! },
  create: { email, name: name!, emailVerified: true },
});

// better-auth keeps the credential on the account row, not the user.
const credential = await prisma.account.findFirst({
  where: { userId: user.id, providerId: "credential" },
});

if (credential) {
  await prisma.account.update({ where: { id: credential.id }, data: { password: hash } });
  console.log(`reset password for ${email} (${user.id})`);
} else {
  await prisma.account.create({
    data: { accountId: user.id, providerId: "credential", userId: user.id, password: hash },
  });
  console.log(`created ${email} (${user.id})`);
}

await prisma.$disconnect();
