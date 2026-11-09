/**
 * @file provision/remote-paths.ts + provision/probe.ts 的安装根契约测试
 * @description 覆盖 resolveInstallRoot() 的合法/非法形态（绝对路径与相对家目录
 *              两种写法）、resolveBasePath() 的拼接，以及安装根在
 *              createRemotePaths() 与 parseInstalledRuntimes() 两处落点的一致性：
 *              改根后 Node、dsh 入口与 DSH_HOME 都跟着换，而 ~/.agents
 *              （账号级技能根）与安装根无关地保持不变。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_DIR_NAME, createRemotePaths, resolveBasePath, resolveInstallRoot,
} from '../../src/provision/remote-paths.js';
import { parseInstalledRuntimes } from '../../src/provision/probe.js';

const HOME = '/home/youruser';

describe('resolveInstallRoot', () => {
  it('空值与空白回落默认根', () => {
    assert.equal(resolveInstallRoot(), BASE_DIR_NAME);
    assert.equal(resolveInstallRoot(''), BASE_DIR_NAME);
    assert.equal(resolveInstallRoot('   '), BASE_DIR_NAME);
  });

  it('接受多段相对路径并归一（去 ./ 前缀与尾斜杠）', () => {
    assert.equal(resolveInstallRoot('data/dsh-remote-explorer'), 'data/dsh-remote-explorer');
    assert.equal(resolveInstallRoot('./data/runtime/'), 'data/runtime');
    assert.equal(resolveInstallRoot('rt_1.2'), 'rt_1.2');
  });

  it('接受绝对路径并归一（去尾斜杠、折叠 MSYS 双斜杠）', () => {
    assert.equal(resolveInstallRoot('/data/rt'), '/data/rt');
    assert.equal(resolveInstallRoot('/data/rt/'), '/data/rt');
    assert.equal(resolveInstallRoot('//data/rt'), '/data/rt', 'Git Bash 下用 // 绕过路径转换');
    assert.equal(resolveInstallRoot('/data/dsh-remote-explorer'), '/data/dsh-remote-explorer');
  });

  it('拒绝根目录 / ~ 前缀 / 反斜杠 / 越界段 / 可疑字符 / MSYS 改写', () => {
    assert.throws(() => resolveInstallRoot('/'), /根目录/);
    assert.throws(() => resolveInstallRoot('///'), /根目录/);
    // Git Bash（MSYS）会把前导斜杠参数改写成 Windows 路径：报错要说清绕法
    assert.throws(() => resolveInstallRoot('C:/Program Files/Git/data/rt'), /MSYS/);
    assert.throws(() => resolveInstallRoot('~/rt'), /不要带 ~/);
    assert.throws(() => resolveInstallRoot('data\\rt'), /反斜杠/);
    assert.throws(() => resolveInstallRoot('/data/../etc'), /不能含/);
    assert.throws(() => resolveInstallRoot('data/../etc'), /不能含/);
    assert.throws(() => resolveInstallRoot('data/$HOME'), /每段只能/);
    assert.throws(() => resolveInstallRoot('/data/rt;rm -rf /'), /每段只能/);
    assert.throws(() => resolveInstallRoot('data/rt name'), /每段只能/);
  });
});

describe('resolveBasePath', () => {
  it('相对根拼在家目录下，绝对根原样返回', () => {
    assert.equal(resolveBasePath(HOME, 'data/rt'), `${HOME}/data/rt`);
    assert.equal(resolveBasePath(`${HOME}/`, 'data/rt'), `${HOME}/data/rt`);
    assert.equal(resolveBasePath(HOME, '/data/rt'), '/data/rt');
    assert.equal(resolveBasePath(HOME, BASE_DIR_NAME), `${HOME}/${BASE_DIR_NAME}`);
  });
});

describe('安装根在路径集合中的落点', () => {
  it('默认根：base = 家目录 + 内置名', () => {
    const paths = createRemotePaths(HOME);
    assert.equal(paths.base, `${HOME}/${BASE_DIR_NAME}`);
    assert.equal(paths.dshHome, paths.base);
  });

  it('相对根：base/DSH_HOME/Node/dsh 入口全部跟着换，~/.agents 不变', () => {
    const paths = createRemotePaths(HOME, 'data/runtime');

    assert.equal(paths.base, `${HOME}/data/runtime`);
    assert.equal(paths.dshHome, `${HOME}/data/runtime`);
    assert.equal(paths.nodeBinDir('v24.21.0'), `${HOME}/data/runtime/node/v24.21.0/bin`);
    assert.equal(paths.dshBin, `${HOME}/data/runtime/node_modules/.bin/dsh`);
    assert.equal(paths.sessionRuntime('s1'), `${HOME}/data/runtime/sessions/s1/.runtime`);
    // 账号级技能根与安装根无关：换根不影响已经装好的技能
    assert.equal(paths.agentsHome, `${HOME}/.agents`);
  });

  it('绝对根（数据盘）：base 就是那个绝对路径，不再拼家目录', () => {
    const paths = createRemotePaths(HOME, '/data/dsh-remote-explorer');

    assert.equal(paths.base, '/data/dsh-remote-explorer');
    assert.equal(paths.dshBin, '/data/dsh-remote-explorer/node_modules/.bin/dsh');
    assert.equal(paths.credentialsFile, '/data/dsh-remote-explorer/.credentials.yaml');
    assert.equal(paths.agentsHome, `${HOME}/.agents`, '技能根仍跟账号走');
  });
});

describe('parseInstalledRuntimes 的安装根', () => {
  it('按传入的相对安装根推断 dsh 入口路径', () => {
    const { dsh } = parseInstalledRuntimes('DSH=0.2.2-rc.1\n', HOME, 'data/runtime');

    assert.deepEqual(dsh, [{
      path: `${HOME}/data/runtime/node_modules/.bin/dsh`,
      version: '0.2.2-rc.1',
    }]);
  });

  it('按传入的绝对安装根推断 dsh 入口路径', () => {
    const { dsh } = parseInstalledRuntimes('DSH=0.2.2-rc.1\n', HOME, '/data/rt');

    assert.equal(dsh[0]?.path, '/data/rt/node_modules/.bin/dsh');
  });

  it('缺省安装根保持旧行为', () => {
    const { dsh } = parseInstalledRuntimes('DSH=0.2.2-rc.1\n', HOME);

    assert.equal(dsh[0]?.path, `${HOME}/${BASE_DIR_NAME}/node_modules/.bin/dsh`);
  });
});
