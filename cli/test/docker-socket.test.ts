import assert from "node:assert/strict";
import { rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hostDockerSocket } from "../src/backends/docker.ts";
import { setEnv, tempDir } from "./support.ts";

test("Docker socket group uses the configured host path without platform-specific commands", (t) => {
  const dir = tempDir(t, "qm-docker-socket-");
  const path = join(dir, "docker.sock");
  writeFileSync(path, "");
  setEnv(t, { DOCKER_HOST: `unix://${path}` });
  assert.deepEqual(hostDockerSocket(), { path, gid: String(statSync(path).gid) });
  rmSync(path);
  assert.throws(() => hostDockerSocket(), /cannot read the Docker socket/);
  process.env.DOCKER_HOST = "tcp://localhost:2375";
  assert.throws(() => hostDockerSocket(), /requires a Unix Docker socket/);
});
