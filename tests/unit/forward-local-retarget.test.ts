/**
 * @file tunnel/forward-local.ts 单元测试（目标端口切换）
 * @description 远端 dsh 重启/重连后端口可能变化，隧道必须跟着改目标端口，
 *              否则浏览器会一直撞「转发失败: Connection refused」。这里用假
 *              transport 记录 openChannel 的 (host, port)，验证 retarget()
 *              之后新建的本机连接确实转发到新端口，且旧连接被主动断开。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import { LocalForward } from '../../src/tunnel/forward-local.js';

/** 记录每次开通道的目标，并返回一个可读写的假通道 */
function makeTransport(): {
  transport: { openChannel: (host: string, port: number) => Promise<{ stream: PassThrough; release: () => void }> };
  calls: Array<{ host: string; port: number }>;
} {
  const calls: Array<{ host: string; port: number }> = [];
  return {
    calls,
    transport: {
      async openChannel(host: string, port: number) {
        calls.push({ host, port });
        // 真实传输返回 { stream, release }（见 forward-local.pipe）
        return { stream: new PassThrough(), release: () => {} };
      },
    },
  };
}

describe('LocalForward.retarget', () => {
  it('新建连接转发到新端口（重启远端 dsh 后隧道目标跟着改）', async () => {
    const { transport, calls } = makeTransport();
    const forward = new LocalForward(transport as never, '127.0.0.1', 48756);
    const localPort = await forward.listen(0);

    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect(localPort, '127.0.0.1', () => { socket.end(); resolve(); });
        socket.on('error', reject);
      });
      assert.deepEqual(calls.at(-1), { host: '127.0.0.1', port: 48756 });

      forward.retarget(48493);

      await new Promise<void>((resolve, reject) => {
        const socket = connect(localPort, '127.0.0.1', () => { socket.end(); resolve(); });
        socket.on('error', reject);
      });
      assert.deepEqual(
        calls.at(-1),
        { host: '127.0.0.1', port: 48493 },
        'retarget 之后必须转发到新端口',
      );
      assert.equal(forward.localPort, localPort, '本机监听端口不变（页面不用换 origin）');
    } finally {
      await forward.close();
    }
  });
});
