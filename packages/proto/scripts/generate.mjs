// Genera src/network.ts desde network.proto (funciona en Windows, macOS y Linux).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const isWin = process.platform === 'win32';
const protoc = join(dirname(require.resolve('grpc-tools/package.json')), 'bin', isWin ? 'protoc.exe' : 'protoc');
const plugin = join(root, 'node_modules', '.bin', isWin ? 'protoc-gen-ts_proto.cmd' : 'protoc-gen-ts_proto');
mkdirSync(join(root, 'src'), { recursive: true });
execFileSync(protoc, [
  `--plugin=protoc-gen-ts_proto=${plugin}`,
  `--ts_proto_out=${join(root, 'src')}`,
  '--ts_proto_opt=esModuleInterop=true,env=browser,forceLong=bigint,oneof=unions-value,outputServices=none,outputJsonMethods=false',
  `--proto_path=${root}`,
  join(root, 'network.proto'),
], { stdio: 'inherit' });
console.log('Protocolo generado en packages/proto/src/network.ts');
