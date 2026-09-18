import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverPlugins } from "../src/plugins.ts";
import type { QmConfig } from "../src/config.ts";
import { tempDir } from "./support.ts";

function makeConfig(plugins: QmConfig["plugins"]): QmConfig {
  return {
    contract: 1,
    orgId: "acme",
    publicUrl: "http://localhost:8080",
    target: "docker",
    services: ["core"],
    plugins,
    skills: [],
    env: {},
    imageOverrides: {},
    sandbox: { app: "acme-sandboxes" },
  };
}

function deployment(t: TestContext, setup: (dir: string) => void): string {
  const dir = tempDir(t, "qm-plugins-");
  setup(dir);
  return dir;
}

function sourceFolder(dir: string, name: string, withDockerfile = true): void {
  mkdirSync(join(dir, "plugins", name), { recursive: true });
  if (withDockerfile) writeFileSync(join(dir, "plugins", name, "Dockerfile"), "FROM scratch\n");
}

test("a plugins/<name>/Dockerfile is auto-discovered as a source plugin (no config entry needed)", (t) => {
  const dir = deployment(t, (d) => sourceFolder(d, "intercom"));
  const { plugins, errors } = discoverPlugins(dir, makeConfig([]));
  assert.deepEqual(errors, []);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0]!.name, "intercom");
  assert.equal(plugins[0]!.kind, "source");
  assert.equal(plugins[0]!.dockerfile, join(dir, "plugins", "intercom", "Dockerfile"));
  assert.deepEqual(plugins[0]!.env, {});
});

test("a config entry attaches env to a source plugin", (t) => {
  const dir = deployment(t, (d) => sourceFolder(d, "intercom"));
  const { plugins, errors } = discoverPlugins(dir, makeConfig([{ name: "intercom", env: { INTERCOM_REGION: "us" } }]));
  assert.deepEqual(errors, []);
  assert.equal(plugins[0]!.kind, "source");
  assert.deepEqual(plugins[0]!.env, { INTERCOM_REGION: "us" });
});

test("a config { name, image } is an image plugin", (t) => {
  const dir = deployment(t, () => {});
  const { plugins, errors } = discoverPlugins(dir, makeConfig([{ name: "linear", image: "ghcr.io/acme/linear:1" }]));
  assert.deepEqual(errors, []);
  assert.equal(plugins[0]!.kind, "image");
  assert.equal(plugins[0]!.image, "ghcr.io/acme/linear:1");
});

test("a name that is BOTH a source folder and an image is an error", (t) => {
  const dir = deployment(t, (d) => sourceFolder(d, "dup"));
  const { errors } = discoverPlugins(dir, makeConfig([{ name: "dup", image: "ghcr.io/x:1" }]));
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /both a source folder .* and an image/);
});

test("a config entry that names neither an image nor a source folder is an error", (t) => {
  const dir = deployment(t, () => {});
  const { errors } = discoverPlugins(dir, makeConfig([{ name: "ghost" }]));
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /names neither an image nor a plugins\/ghost\/ source folder/);
});

test("a plugins/<name>/ folder without a Dockerfile (and no image) is an error", (t) => {
  const dir = deployment(t, (d) => sourceFolder(d, "halfbaked", false));
  const { errors } = discoverPlugins(dir, makeConfig([{ name: "halfbaked" }]));
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /has a plugins\/halfbaked\/ folder but no Dockerfile/);
});

test("a source plugin whose folder name is a reserved built-in (e.g. core) is an error, not run", (t) => {
  const dir = deployment(t, (d) => sourceFolder(d, "core"));
  const { plugins, errors } = discoverPlugins(dir, makeConfig([]));
  assert.deepEqual(plugins, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /collides with a built-in container/);
});

test("reserved-name rejection covers pg too", (t) => {
  const dir = deployment(t, (d) => sourceFolder(d, "pg"));
  const { plugins, errors } = discoverPlugins(dir, makeConfig([]));
  assert.deepEqual(plugins, []);
  assert.match(errors[0]!, /collides with a built-in container/);
});

test("a source plugin folder whose name isn't a lowercase DNS label is an error, not run", (t) => {
  const dir = deployment(t, (d) => sourceFolder(d, "MyPlugin"));
  const { plugins, errors } = discoverPlugins(dir, makeConfig([]));
  assert.deepEqual(plugins, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /must be a lowercase DNS label/);
});

test("a bare deployment with no plugins/ dir and no config plugins discovers nothing", (t) => {
  const dir = deployment(t, () => {});
  const { plugins, errors } = discoverPlugins(dir, makeConfig([]));
  assert.deepEqual(plugins, []);
  assert.deepEqual(errors, []);
});

test("a symlinked plugin folder is discovered as a source plugin (layers share one plugin via symlink)", (t) => {
  const dir = deployment(t, (d) => {
    mkdirSync(join(d, "real-plugin"), { recursive: true });
    writeFileSync(join(d, "real-plugin", "Dockerfile"), "FROM scratch\n");
    mkdirSync(join(d, "plugins"), { recursive: true });
    symlinkSync(join(d, "real-plugin"), join(d, "plugins", "relay"));
  });
  const { plugins, errors } = discoverPlugins(dir, makeConfig([]));
  assert.deepEqual(errors, []);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0]!.name, "relay");
  assert.equal(plugins[0]!.kind, "source");
});

test("a broken symlink in plugins/ is ignored, not a crash", (t) => {
  const dir = deployment(t, (d) => {
    mkdirSync(join(d, "plugins"), { recursive: true });
    symlinkSync(join(d, "nowhere"), join(d, "plugins", "ghost"));
  });
  const { plugins, errors } = discoverPlugins(dir, makeConfig([]));
  assert.deepEqual(plugins, []);
  assert.deepEqual(errors, []);
});
