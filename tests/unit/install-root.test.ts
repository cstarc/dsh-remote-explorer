/**
 * @file provision/remote-paths.ts + provision/probe.ts 的安装根契约测试
 * @description 覆盖 resolveBaseDirName() 的合法/非法形态，以及安装根在
 *              createRemotePaths() 与 parseInstalledRuntimes() 两处落点的
 *              一致性：改根后 Node、dsh 入口与 DSH_HOME 都跟着换，
 *              而 ~/.agents（账号级技能根）与家目录无关地保持不变。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_DIR_NAME, createRemotePaths, resolveBaseDirName } from '../../src/provision/remote-paths.js';
import { parseInstalledRuntimes } from '../../src/provision/probe.js';

const HOME = '/home/youruser';

describe('resolveBaseDirName', () => {
  it('空值与空白回落默认根', () => {
    assert.equal(resolveBaseDirName(), BASE_DIR_NAME);
    assert.equal(resolveBaseDirName(''), BASE_DIR_NAME);
    assert.equal(resolveBaseDirName('   '), BASE_DIR_NAME);
  });

  it('接受多段相对路径并归一（去 ./ 前缀与尾斜杠）', () => {
    assert.equal(resolveBaseDirName('data/dsh-remote-explorer'), 'data/dsh-remote-explorer');
    assert.equal(resolveBaseDirName('./data/runtime/'), 'data/runtime');
    assert.equal(resolveBaseDirName('rt_1.2'), 'rt_1.2');
  });

  it('拒绝绝对路径 / ~ 前缀 / 反斜杠 / 越界段 / 可疑字符', () => {
    assert.throws(() => resolveBaseDirName('/data/rt'), /相对家目录/);
    // Git Bash（MSYS）会把前导斜杠参数改写成 Windows 路径：报错要说清绕法
    assert.throws(() => resolveBaseDirName('C:/Program Files/Git/data/rt'), /MSYS/);
    assert.throws(() => resolveBaseDirName('~/rt'), /不要带 ~/);
    assert.throws(() => resolveBaseDirName('data\\rt'), /反斜杠/);
    assert.throws(() => resolveBaseDirName('data/../etc'), /每段限|不能含/);
    assert.throws(() => resolveBaseDirName('data/$HOME'), /每段限/);
    assert.throws(() => resolveBaseDirName('data/rt;rm -rf /'), /每段限/);
    assert.throws(() => resolveBaseDirName('data/rt name'), /每段限/);
  });
});

describe('安装根在路径集合中的落点', () => {
  it('默认根：base = 家目录 + 内置名', () => {
    const paths = createRemotePaths(HOME);
    assert.equal(paths.base, `${HOME}/${BASE_DIR_NAME}`);
    assert.equal(paths.dshHome, paths.base);
  });

  it('改根：base/DSH_HOME/Node/dsh 入口全部跟着换，~/.agents 不变', () => {
    const paths = createRemotePaths(HOME, 'data/runtime');

    assert.equal(paths.base, `${HOME}/data/runtime`);
    assert.equal(paths.dshHome, `${HOME}/data/runtime`);
    assert.equal(paths.nodeBinDir('v24.21.0'), `${HOME}/data/runtime/node/v24.21.0/bin`);
    assert.equal(paths.dshBin, `${HOME}/data/runtime/node_modules/.bin/dsh`);
    assert.equal(paths.sessionRuntime('s1'), `${HOME}/data/runtime/sessions/s1/.runtime`);
    // 账号级技能根与安装根无关：换根不影响已经装好的技能
    assert.equal(paths.agentsHome, `${HOME}/.agents`);
  });
});

describe('parseInstalledRuntimes 的安装根', () => {
  it('按传入的安装根推断 dsh 入口路径', () => {
    const { dsh } = parseInstalledRuntimes('DSH=0.2.2-rc.1\n', HOME, 'data/runtime');

    assert.deepEqual(dsh, [{
      path: `${HOME}/data/runtime/node_modules/.bin/dsh`,
      version: '0.2.2-rc.1',
    }]);
  });

  it('缺省安装根保持旧行为', () => {
    const { dsh } = parseInstalledRuntimes('DSH=0.2.2-rc.1\n', HOME);

    assert.equal(dsh[0]?.path, `${HOME}/${BASE_DIR_NAME}/node_modules/.bin/dsh`);
  });
});
