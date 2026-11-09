import { hashPassword } from "better-auth/crypto";

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  console.error("Run this command in an interactive terminal so the password can stay hidden.");
  process.exit(1);
}

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    let password = "";

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Password generation cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
          continue;
        }
        if (character >= " " && character !== "\u001b") password += character;
      }
    };

    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

let password = "";
try {
  process.stdout.write("Temporary password (input hidden): ");
  password = await readHiddenPassword();

  if (password.length < 10 || password.length > 128) {
    throw new Error("Use a password between 10 and 128 characters.");
  }
  const passwordHash = await hashPassword(password);
  if (!/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(passwordHash)) {
    throw new Error("The installed Better Auth library returned an unexpected hash format.");
  }

  console.log(passwordHash);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not generate the password hash.");
  process.exitCode = 1;
} finally {
  password = "";
}
