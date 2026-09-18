import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runChecks, runCheckCommand } from "../src/commands/check.ts";
import type { QmConfig } from "../src/config.ts";
import { computedSecrets, renderEnvExample } from "../src/secrets.ts";
import { dockerConfig, tempDir } from "./support.ts";

const CONFIG = dockerConfig({ sandbox: { app: "acme-sandboxes" } });

function deployment(
  t: TestContext,
  setup: (dir: string) => void,
  config: Partial<QmConfig> = {},
): { dir: string; config: QmConfig } {
  const dir = tempDir(t, "qm-check-");
  setup(dir);
  return { dir, config: { ...CONFIG, ...config } };
}

function writeTool(dir: string, id: string, descriptor: object, withExe = true): void {
  const td = join(dir, "sandbox", "tools", id);
  mkdirSync(td, { recursive: true });
  writeFileSync(join(td, "tool.json"), JSON.stringify(descriptor));
  if (withExe) {
    writeFileSync(join(td, id), "#!/usr/bin/env bash\necho hi\n");
    chmodSync(join(td, id), 0o755);
  }
}

function writeSkill(dir: string, id: string, frontmatter: string): void {
  mkdirSync(join(dir, "sandbox", "skills", id), { recursive: true });
  writeFileSync(join(dir, "sandbox", "skills", id, "SKILL.md"), `---\n${frontmatter}\n---\nbody\n`);
}

function check(d: { dir: string; config: QmConfig }): ReturnType<typeof runChecks> {
  return runChecks(d.config, d.dir, join(d.dir, "sandbox"), { report: false });
}

test("a valid sandbox layer passes and returns the parsed tools + skills", (t) => {
  const d = deployment(t, (dir) => {
    writeTool(dir, "example-tool", {
      id: "example-tool",
      advertise: "example-tool",
      install: { binary: "example-tool" },
    });
    writeSkill(dir, "greet", "name: greet\ndescription: Greet a teammate.");
  });
  const { layer, plugins } = check(d);
  assert.equal(layer.tools.length, 1);
  assert.equal(layer.skills.length, 1);
  assert.deepEqual(plugins, []);
});

test("every Fly deployment requires durable S3-compatible stores", (t) => {
  const base = {
    target: "fly" as const,
    region: "sjc",
    flyOrg: "personal",
    services: ["core", "portal"] as QmConfig["services"],
  };
  const ephemeral = deployment(t, () => {}, base);
  const durable = deployment(t, () => {}, {
    ...base,
    env: { core: { SNAPSHOT_STORE: "s3", TRANSFER_STORE: "s3", S3_BUCKET: "acme-data", S3_REGION: "auto" } },
  });
  assert.throws(() => check(ephemeral), /Fly deployment requires env\.core\.SNAPSHOT_STORE/);
  assert.doesNotThrow(() => check(durable));
});

test("a malformed tool.json fails the check", (t) => {
  const d = deployment(t, (dir) => {
    mkdirSync(join(dir, "sandbox", "tools", "bad"), { recursive: true });
    writeFileSync(join(dir, "sandbox", "tools", "bad", "tool.json"), "{ not json }");
  });
  assert.throws(() => check(d), /check failed/);
  assert.throws(() => check(d), /not valid JSON/);
});

test("a SKILL.md missing required frontmatter fails the check", (t) => {
  const d = deployment(t, (dir) => writeSkill(dir, "broken", "description: no name here"));
  assert.throws(() => check(d), /missing "name"/);
});

test("a tool with no executable and no Dockerfile fails (can't get its binary on PATH)", (t) => {
  const d = deployment(t, (dir) =>
    writeTool(dir, "needs-bin", { id: "needs-bin", install: { binary: "needs-bin" } }, false),
  );
  assert.throws(() => check(d), /can't get its binary on PATH/);
});

test("a tool with no executable BUT a sandbox/Dockerfile passes (Dockerfile installs it)", (t) => {
  const d = deployment(t, (dir) => {
    writeTool(dir, "apt-tool", { id: "apt-tool", install: { binary: "apt-tool" } }, false);
    writeFileSync(join(dir, "sandbox", "Dockerfile"), "FROM base\nRUN apt-get install -y apt-tool\n");
  });
  const { layer } = check(d);
  assert.equal(layer.tools.length, 1);
  assert.ok(layer.hasDockerfile);
});

test("duplicate tool ids are flagged", (t) => {
  const d = deployment(t, (dir) => {
    writeTool(dir, "folderA", { id: "same", install: { binary: "same" } });
    writeTool(dir, "folderB", { id: "same", install: { binary: "same" } });
  });
  assert.throws(() => check(d), /duplicate tool id "same"/);
});

test("a plugin that is both a source folder and an image is flagged", (t) => {
  const d = deployment(t, (dir) => mkdirSync(join(dir, "plugins", "dup"), { recursive: true }), {
    plugins: [{ name: "dup", image: "ghcr.io/x:1" }],
  });
  writeFileSync(join(d.dir, "plugins", "dup", "Dockerfile"), "FROM scratch\n");
  assert.throws(() => check(d), /both a source folder .* and an image/);
});

test("a config plugin naming neither an image nor a source folder is flagged", (t) => {
  const d = deployment(t, () => {}, { plugins: [{ name: "ghost" }] });
  assert.throws(() => check(d), /names neither an image nor/);
});

test("a bare deployment (no sandbox/, no plugins) passes", (t) => {
  const d = deployment(t, () => {});
  const { layer, plugins } = check(d);
  assert.equal(layer.exists, false);
  assert.deepEqual(plugins, []);
});

test("docker with sandbox.backend local passes without a Fly sandbox app", (t) => {
  const d = deployment(t, () => {}, { sandbox: { backend: "local", image: "qm-sandbox-local:latest" } });
  assert.doesNotThrow(() => check(d));
});

test("AWS requires exact ECS/ECR coordinates for discovered plugins", (t) => {
  const plugin = { name: "linear", image: "ghcr.io/acme/linear:1" };
  const aws = {
    accountId: "123456789012",
    region: "us-west-2",
    cluster: "acme",
    deployRoleArn: "arn:aws:iam::123456789012:role/deploy",
    secretsPrefix: "acme/",
    imageLabel: "release",
    networking: { cloudMapNamespace: "acme.internal" },
    services: {
      core: { ecrRepository: "core", ecsService: "acme-core", cpu: 512, memory: 1024 },
      linear: {
        ecrRepository: "linear",
        ecsService: "acme-linear",
        cpu: 256,
        memory: 512,
        architecture: "amd64" as const,
      },
    },
  };
  const d = deployment(t, () => {}, { target: "aws", plugins: [plugin], aws });
  assert.doesNotThrow(() => check(d));
  delete d.config.aws!.services.linear!.architecture;
  assert.throws(() => check(d), /aws\.services\.linear\.architecture is required/);
  d.config.aws!.services.linear!.architecture = "amd64";
  delete d.config.aws!.services.linear;
  assert.throws(() => check(d), /aws\.services\.linear/);
});

test("AWS accepts retained bundled coordinates only when their host is enabled", (t) => {
  const d = deployment(t, () => {}, {
    target: "aws",
    services: ["core", "web-ui", "admin", "portal", "auth"],
    aws: {
      accountId: "123456789012",
      region: "us-west-2",
      cluster: "acme",
      deployRoleArn: "arn:aws:iam::123456789012:role/deploy",
      secretsPrefix: "acme/",
      imageLabel: "release",
      networking: { cloudMapNamespace: "acme.internal" },
      services: Object.fromEntries(
        ["core", "web-ui", "admin", "portal", "auth"].map((name) => [
          name,
          { ecrRepository: name, ecsService: `acme-${name}`, cpu: 512, memory: 1024 },
        ]),
      ),
    },
  });
  assert.doesNotThrow(() => check(d));
  delete d.config.aws!.services["web-ui"];
  assert.throws(() => check(d), /aws\.services\.web-ui/);
  d.config.services = ["core"];
  delete d.config.aws!.services.portal;
  assert.throws(() => check(d), /aws\.services\.(admin|auth)/);
  delete d.config.aws!.services.admin;
  delete d.config.aws!.services.auth;
  d.config.aws!.services.unused = { ecrRepository: "unused", ecsService: "unused", cpu: 512, memory: 1024 };
  assert.throws(() => check(d), /aws\.services\.unused/);
});

test("optional plugin secrets remain in the computed contract without becoming required", () => {
  const optional: QmConfig = {
    ...CONFIG,
    plugins: [{ name: "linear", image: "ghcr.io/acme/linear:1", secrets: [{ name: "LINEAR_TOKEN", required: false }] }],
  };
  const secret = computedSecrets(optional).find((item) => item.name === "LINEAR_TOKEN");
  assert.equal(secret?.required, false);
  assert.ok(renderEnvExample(optional).includes("# LINEAR_TOKEN=  # optional"));
});

test("check rejects what the core's deployment-layer API would reject: binary skill assets", (t) => {
  const d = deployment(t, (dir) => {
    writeSkill(dir, "greet", "name: greet\ndescription: g.");
    writeFileSync(
      join(dir, "sandbox", "skills", "greet", "logo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    );
  });
  assert.throws(() => check(d), /text skill assets/);
});

test("OS junk files inside a skill dir pass check (push skips them too)", (t) => {
  const d = deployment(t, (dir) => {
    writeSkill(dir, "greet", "name: greet\ndescription: g.");
    writeFileSync(
      join(dir, "sandbox", "skills", "greet", ".DS_Store"),
      Buffer.from([0x00, 0x01, 0x42, 0x75, 0x64, 0x31]),
    );
    writeFileSync(join(dir, "sandbox", "skills", "greet", "._notes.md"), Buffer.from([0x00, 0x05, 0x16, 0x07]));
  });
  const { layer } = check(d);
  assert.deepEqual(layer.errors, []);
});

test("secret-looking literals in plugin and sandbox env fail config.no-secret-values", (t) => {
  const viaPlugin = deployment(t, () => {}, {
    plugins: [{ name: "linear", image: "ghcr.io/x:1", env: { LINEAR_API_KEY: "lin_x" } }],
  });
  const viaSandbox = deployment(t, () => {}, {
    sandbox: { app: "acme-sandboxes", env: { GH_TOKEN: "ghp_x" } },
  });
  const viaKey = deployment(t, () => {}, { env: { core: { AWS_SECRET_ACCESS_KEY: "aws_x" } } });
  const viaCred = deployment(t, () => {}, {
    sandbox: {
      app: "acme-sandboxes",
      env: { PGPASSWORD: "pg_x", GOOGLE_CREDENTIALS: "{}" },
    },
  });
  const benign = deployment(t, () => {}, {
    sandbox: {
      app: "acme-sandboxes",
      env: { JWT_PUBLIC_KEY: "MFkw...", GOOGLE_APPLICATION_CREDENTIALS: "/run/secrets/gcp.json" },
    },
  });
  assert.throws(() => check(viaPlugin), /plugins\.linear\.LINEAR_API_KEY belongs in the target secret store/);
  assert.throws(() => check(viaSandbox), /sandbox\.GH_TOKEN belongs in the target secret store/);
  assert.throws(() => check(viaKey), /core\.AWS_SECRET_ACCESS_KEY belongs in the target secret store/);
  assert.throws(() => check(viaCred), /sandbox\.PGPASSWORD belongs in the target secret store/);
  assert.throws(() => check(viaCred), /sandbox\.GOOGLE_CREDENTIALS belongs in the target secret store/);
  check(benign);
});

test("secret-looking AWS build arguments fail config.no-secret-values", (t) => {
  const d = deployment(t, () => {}, {
    target: "aws",
    aws: {
      accountId: "123456789012",
      region: "us-west-2",
      cluster: "acme",
      deployRoleArn: "arn:aws:iam::123456789012:role/deploy",
      secretsPrefix: "acme/",
      imageLabel: "release",
      networking: { cloudMapNamespace: "acme.internal" },
      services: {
        core: {
          ecrRepository: "core",
          ecsService: "acme-core",
          cpu: 512,
          memory: 1024,
          buildArgs: { NPM_TOKEN: "secret" },
        },
      },
    },
  });
  assert.throws(() => check(d), /aws\.services\.core\.buildArgs\.NPM_TOKEN belongs in the target secret store/);
});

test("check rejects symlinked skill assets before any deploy rolls", (t) => {
  const d = deployment(t, (dir) => {
    writeSkill(dir, "greet", "name: greet\ndescription: g.");
    symlinkSync(
      join(dir, "sandbox", "skills", "greet", "SKILL.md"),
      join(dir, "sandbox", "skills", "greet", "link.md"),
    );
  });
  assert.throws(() => check(d), /regular file/);
});

test("check rejects files directly under skills/ (the core 400s skills/<id>/<file> violations)", (t) => {
  const d = deployment(t, (dir) => {
    writeSkill(dir, "greet", "name: greet\ndescription: g.");
    writeFileSync(join(dir, "sandbox", "skills", "README.md"), "stray\n");
  });
  assert.throws(() => check(d), /skills\/<id>\/<file>/);
});

test("check enforces the core API's 1 MB layer limit", (t) => {
  const d = deployment(t, (dir) => {
    writeSkill(dir, "big", `name: big\ndescription: b.\n---\n${"x".repeat(1_100_000)}`);
  });
  assert.throws(() => check(d), /1 MB/);
});

test("egress accepts CIDR ranges, warns on /0, and still rejects URLs and paths", (t) => {
  const d = deployment(t, (dir) => {
    writeTool(dir, "net-tool", {
      id: "net-tool",
      egress: ["api.example.com", "10.0.0.0/8", "2001:db8::/32", "0.0.0.0/0"],
    });
  });
  const { layer } = check(d);
  assert.ok(
    layer.warnings.some((warning) => warning.includes("0.0.0.0/0")),
    "broad /0 egress still warns",
  );
  const bad = deployment(t, (dir) => {
    writeTool(dir, "url-tool", { id: "url-tool", egress: ["https://api.example.com", "example.com/path"] });
  });
  assert.throws(() => check(bad), /must name a host or a CIDR range/);
});

test("a secretEnv alias colliding with another secret's delivery on the same workload fails config.secretEnv", (t) => {
  const collide = deployment(t, () => {}, {
    secretEnv: { core: { CORE_SIGNING_SECRET: "SOME_OTHER_NAME" } },
  });
  const folded = deployment(t, () => {}, {
    services: ["core", "slack"],
    secretEnv: { core: { SHARED_NAME: "STORE_A" }, slack: { SHARED_NAME: "STORE_B" } },
  });
  const benign = deployment(t, () => {}, {
    services: ["core", "slack"],
    secretEnv: { core: { EXTRA_API_KEY: "EXTRA_API_KEY" }, slack: { APPS_ALIAS: "EXTRA_API_KEY" } },
  });
  assert.throws(
    () => check(collide),
    /core would receive env CORE_SIGNING_SECRET from both CORE_SIGNING_SECRET and SOME_OTHER_NAME/,
  );
  assert.throws(() => check(folded), /core would receive env SHARED_NAME from both STORE_A and STORE_B/);
  check(benign);
});

test("plaintext config env colliding with a secretEnv name (plain or alias) fails config.no-secret-values", (t) => {
  const plain = deployment(t, () => {}, {
    env: { core: { EXTRA_CDP_URL: "wss://plaintext.example" } },
    secretEnv: { core: { EXTRA_CDP_URL: "EXTRA_CDP_URL" } },
  });
  const aliased = deployment(t, () => {}, {
    env: { core: { APPS_SESSION_ALIAS: "plaintext" } },
    secretEnv: { core: { APPS_SESSION_ALIAS: "PORTAL_SESSION_SECRET" } },
  });
  assert.throws(() => check(plain), /core\.EXTRA_CDP_URL belongs in the target secret store/);
  assert.throws(() => check(aliased), /core\.APPS_SESSION_ALIAS belongs in the target secret store/);
});

test("a delivered secret name shadowing renderer-derived env fails config.secretEnv (aws target)", (t) => {
  const aws = {
    accountId: "123456789012",
    region: "us-west-2",
    cluster: "acme",
    imageLabel: "release",
    deployRoleArn: "arn:aws:iam::123456789012:role/deploy",
    secretsPrefix: "acme/",
    networking: { cloudMapNamespace: "acme.internal" },
    services: { core: { ecrRepository: "qm-core", ecsService: "acme-core", cpu: 2048, memory: 4096 } },
  } as const;
  const base = { target: "aws" as const, aws, env: { core: { AWS_DEPLOY_IMAGE: "acme-sandbox" } } };
  const shadowed = deployment(t, () => {}, { ...base, secretEnv: { core: { S3_BUCKET: "SOME_SECRET_BUCKET_URL" } } });
  const overridden = deployment(t, () => {}, {
    ...base,
    env: { core: { AWS_DEPLOY_IMAGE: "acme-sandbox", S3_BUCKET: "adopted-bucket" } },
    secretEnv: { core: { S3_BUCKET: "SOME_SECRET_BUCKET_URL" } },
  });
  const benign = deployment(t, () => {}, { ...base, secretEnv: { core: { EXTRA_API_KEY: "EXTRA_API_KEY" } } });
  const dockerTarget = deployment(t, () => {}, { secretEnv: { core: { ORG_ID: "SOME_STORE_NAME" } } });
  assert.throws(
    () => check(shadowed),
    /core env S3_BUCKET is derived by the deployment target and cannot also be delivered as a secret/,
  );
  assert.throws(
    () => check(overridden),
    /core\.S3_BUCKET belongs in the target secret store|core env S3_BUCKET/,
    "a config-env override colliding with a delivered secret is still an error",
  );
  check(benign);
  check(dockerTarget);
});

test("quiet checks reject invalid supplied sandbox credentials just like human checks", async (t) => {
  const { dir, config } = deployment(t, () => {});
  writeFileSync(join(dir, ".env"), "FLY_SANDBOX_API_TOKEN=fm2_invalid\n");
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
  for (const report of [false, true]) {
    await assert.rejects(
      runCheckCommand(config, dir, join(dir, "sandbox"), undefined, report),
      /cannot access the Fly app/,
    );
  }
});

test("only public PostHog ingestion tokens may be configured as plaintext", (t) => {
  for (const value of ["phc_example123", "phx_personal123", "private-token"]) {
    const d = deployment(t, () => {}, { env: { core: { POSTHOG_API_KEY: value } } });
    if (value.startsWith("phc_")) assert.doesNotThrow(() => check(d));
    else assert.throws(() => check(d), /POSTHOG_API_KEY belongs in the target secret store/);
  }
});
