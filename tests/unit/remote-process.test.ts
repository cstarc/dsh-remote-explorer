/**
 * @file session/remote-process.ts 单元测试（纯函数部分）
 * @description 覆盖 buildRunnerScript() 的脚本文本契约：pid 行保留（`echo $$`）、
 *              远端目录 cd 在 exec 之前、cd 失败分支写日志并非零退出、cwd 缺省
 *              时不插 cd、路径经单引号字面量化（含空格与注入尝试）、WSL 与 SSH
 *              的重定向差异。真实启动行为由 doctor/connect 实跑验证
 *              （CLAUDE.md 硬约束），这里只锁「拼出来的脚本长什么样」。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunnerScript } from '../../src/session/remote-process.js';

/** 测试用的公共输入（只改单个字段，突出断言对象） */
const BASE = {
  pidFile: '/home/youruser/.dsh-remote-explorer/btsd321/sessions/s1/.runtime/pid',
  logFile: '/home/youruser/.dsh-remote-explorer/btsd321/sessions/s1/.runtime/dsh.log',
  envAssignments: ['DSH_HOME=/home/youruser/.dsh-remote-explorer/btsd321', 'PATH=/opt/node/bin:"$PATH"'],
  startCommand: '/home/youruser/.dsh-remote-explorer/btsd321/node_modules/.bin/dsh --profile web',
  isWsl: false,
};

describe('buildRunnerScript', () => {
  it('cwd 非空时在 exec 之前 cd，且 pid 行仍是 echo $$', () => {
    const script = buildRunnerScript({ ...BASE, cwd: '/data/trunk/LTSQL/unisql' });
    const lines = script.split('\n');

    assert.equal(lines[0], '#!/bin/sh');
    assert.equal(lines[1], `echo $$ > ${BASE.pidFile}`, 'pid 行必须是 shell 自身的 $$');
    assert.match(lines[2] ?? '', /^cd \/data\/trunk\/LTSQL\/unisql \|\|/, 'cd 是第三行');
    assert.ok(script.includes('exec env '), '仍然 exec 启动 dsh');
    assert.ok(
      script.indexOf('cd /data/trunk/LTSQL/unisql') < script.indexOf('exec env '),
      'cd 必须早于 exec',
    );
  });

  it('cd 失败分支把原因写进启动日志并非零退出（不静默回落家目录）', () => {
    const script = buildRunnerScript({ ...BASE, cwd: '/data/missing' });

    assert.ok(script.includes(`>> ${BASE.logFile}`), '原因写进 dsh.log，轮询能读到');
    assert.ok(script.includes('exit 1; }'), 'cd 失败必须非零退出');
    assert.ok(script.includes('无法进入远端工作目录 /data/missing'), '原因里带具体目录');
  });

  it('cwd 缺省或空串时不插 cd（保持登录目录的原行为）', () => {
    for (const cwd of [undefined, '']) {
      const script = buildRunnerScript({ ...BASE, ...(cwd === undefined ? {} : { cwd }) });
      assert.ok(!script.includes('cd '), `cwd=${String(cwd)} 时不应有 cd`);
      assert.equal(script.split('\n').length, 4, '脚本只剩 shebang + pid + exec + 结尾空行');
    }
  });

  it('含空格与单引号的目录经字面量化，不构成命令注入', () => {
    const cwd = "/data/my project'; rm -rf / #";
    const script = buildRunnerScript({ ...BASE, cwd });

    assert.ok(script.includes(`cd '${cwd.replaceAll("'", `'\\''`)}' ||`), '整段按单引号字面量转义');
    assert.ok(!script.includes('; rm -rf / # ||'), '原始文本不得裸露在引号外');
  });

  it('SSH 不重复重定向（detach 命令已重定向），WSL 必须自己重定向', () => {
    const ssh = buildRunnerScript({ ...BASE, cwd: '/data' });
    const wsl = buildRunnerScript({ ...BASE, cwd: '/data', isWsl: true });

    const sshExec = ssh.split('\n').find((line) => line.startsWith('exec env ')) ?? '';
    assert.ok(!sshExec.includes('> '), 'SSH 的 exec 行不带重定向');

    const wslExec = wsl.split('\n').find((line) => line.startsWith('exec env ')) ?? '';
    assert.equal(wslExec, `exec env ${BASE.envAssignments.join(' ')} ${BASE.startCommand} > ${BASE.logFile} 2>&1`);
  });

  it('环境变量与启动命令原样进入 exec 行，脚本以换行结尾', () => {
    const script = buildRunnerScript({ ...BASE, cwd: '/data' });

    assert.ok(script.includes(`exec env ${BASE.envAssignments.join(' ')} ${BASE.startCommand}`));
    assert.ok(script.endsWith('\n'), 'runner 文件以换行结尾，避免最后一行被截断');
  });
});
