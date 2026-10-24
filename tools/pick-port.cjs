// 便携版启动器用：在 7317-7326 之间找一个空闲端口，打印出来；全占用则打印 0
const net = require('node:net');

const PORTS = [7317, 7318, 7319, 7320, 7321, 7322, 7323, 7324, 7325, 7326];

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

(async () => {
  for (const port of PORTS) {
    if (await isFree(port)) {
      console.log(port);
      return;
    }
  }
  console.log(0);
})();
